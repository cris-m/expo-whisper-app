import Foundation
import AVFoundation

/// Swift wrapper for whisper.cpp context using Objective-C wrapper
public class WhisperContext {
    private let contextId: Int
    private var wrapper: WhisperWrapper?
    private var currentJobId: Int = -1
    private var isAborted: Bool = false

    let isGpuEnabled: Bool
    let reasonNoGpu: String

    private static let sampleRate: Double = 16000.0

    private var audioBufferManager: AudioBufferManager?

    init(modelPath: String, contextId: Int, useGpu: Bool, useCoreML: Bool, useFlashAttn: Bool) throws {
        self.contextId = contextId

        guard let wrapper = WhisperWrapper(
            modelPath: modelPath,
            useGpu: useGpu,
            useCoreML: useCoreML,
            useFlashAttn: useFlashAttn
        ) else {
            throw WhisperError.transcriptionFailed("Failed to load model from: \(modelPath)")
        }

        self.wrapper = wrapper
        self.isGpuEnabled = useGpu
        self.reasonNoGpu = useGpu ? "" : "GPU disabled or not available"
    }

    static func getLibVersion() -> String {
        return "1.0.0"
    }

    func transcribe(
        audioPath: String,
        jobId: Int,
        options: [String: Any],
        onProgress: ((Int) -> Void)?,
        onNewSegments: (([String: Any]) -> Void)?
    ) async throws -> [String: Any] {
        guard let wrapper = wrapper, wrapper.isContextReady() else {
            throw WhisperError.contextNotFound
        }

        self.currentJobId = jobId
        self.isAborted = false

        // Load audio file
        let audioData = try loadAudioFile(path: audioPath)

        // Convert Float array to NSData
        let audioDataNS = audioData.withUnsafeBufferPointer { bufferPointer in
            NSData(bytes: bufferPointer.baseAddress!, length: audioData.count * MemoryLayout<Float>.stride)
        }

        let language = options["language"] as? String
        let translate = options["translate"] as? Bool ?? false
        let maxTokens = options["maxTokens"] as? Int ?? 0

        let progressCb: WhisperProgressCallback? = onProgress != nil ? { progress in
            onProgress?(Int(progress))
        } : nil

        let segmentCb: WhisperNewSegmentCallback? = onNewSegments != nil ? { text, startTime, endTime in
            onNewSegments?([
                "text": text as Any,
                "t0": startTime,
                "t1": endTime
            ])
        } : nil

        let rawResult: [AnyHashable: Any]?
        do {
            rawResult = try wrapper.transcribeAudioSamples(
                audioDataNS as Data,
                sampleRate: Int32(Self.sampleRate),
                language: language,
                translate: translate,
                maxTokens: Int32(maxTokens),
                progressCallback: progressCb,
                newSegmentCallback: segmentCb
            )
        } catch {
            throw WhisperError.transcriptionFailed(error.localizedDescription)
        }

        if self.isAborted {
            return [
                "result": "",
                "segments": [] as [[String: Any]],
                "isAborted": true
            ]
        }

        guard let rawResult = rawResult else {
            throw WhisperError.transcriptionFailed("Transcription returned nil result")
        }

        // Convert to [String: Any]
        var result: [String: Any] = [:]
        for (key, value) in rawResult {
            if let stringKey = key as? String {
                result[stringKey] = value
            }
        }

        return [
            "result": result["result"] ?? "",
            "segments": result["segments"] ?? [],
            "isAborted": false
        ]
    }

    // MARK: - Buffer Transcription
    func transcribeData(
        audioData: Data,
        jobId: Int,
        options: [String: Any],
        onProgress: ((Int) -> Void)?,
        onNewSegments: (([String: Any]) -> Void)?
    ) async throws -> [String: Any] {
        guard let wrapper = wrapper, wrapper.isContextReady() else {
            throw WhisperError.contextNotFound
        }

        self.currentJobId = jobId
        self.isAborted = false

        // Parse WAV file from buffer
        let floatArray = try parseWAVBuffer(audioData: audioData)

        // Validate audio content
        guard floatArray.count > 0 else {
            throw WhisperError.transcriptionFailed("No audio data in buffer")
        }

        // Check if audio is reasonably long (at least 0.5 seconds at 16kHz)
        if floatArray.count < 8000 {
            return [
                "result": "",
                "segments": [] as [[String: Any]],
                "isAborted": false,
                "reason": "Audio too short (minimum 0.5 seconds required)"
            ]
        }

        // Convert Float array to NSData
        let audioDataNS = floatArray.withUnsafeBufferPointer { bufferPointer in
            NSData(bytes: bufferPointer.baseAddress!, length: floatArray.count * MemoryLayout<Float>.stride)
        }

        let language = options["language"] as? String
        let translate = options["translate"] as? Bool ?? false
        let maxTokens = options["maxTokens"] as? Int ?? 0

        let progressCb: WhisperProgressCallback? = onProgress != nil ? { progress in
            onProgress?(Int(progress))
        } : nil

        let segmentCb: WhisperNewSegmentCallback? = onNewSegments != nil ? { text, startTime, endTime in
            onNewSegments?([
                "text": text as Any,
                "t0": startTime,
                "t1": endTime
            ])
        } : nil

        let rawResult: [AnyHashable: Any]?
        do {
            rawResult = try wrapper.transcribeAudioSamples(
                audioDataNS as Data,
                sampleRate: Int32(Self.sampleRate),
                language: language,
                translate: translate,
                maxTokens: Int32(maxTokens),
                progressCallback: progressCb,
                newSegmentCallback: segmentCb
            )
        } catch {
            throw WhisperError.transcriptionFailed(error.localizedDescription)
        }

        if self.isAborted {
            return [
                "result": "",
                "segments": [] as [[String: Any]],
                "isAborted": true
            ]
        }

        guard let rawResult = rawResult else {
            throw WhisperError.transcriptionFailed("Transcription returned nil result")
        }

        // Convert to [String: Any]
        var result: [String: Any] = [:]
        for (key, value) in rawResult {
            if let stringKey = key as? String {
                result[stringKey] = value
            }
        }

        return [
            "result": result["result"] ?? "",
            "segments": result["segments"] ?? [],
            "isAborted": false
        ]
    }

    func startRealtimeTranscribe(
        jobId: Int,
        options: [String: Any],
        onTranscribe: @escaping ([String: Any]) -> Void,
        onEnd: @escaping ([String: Any]) -> Void
    ) async throws {
        guard let wrapper = wrapper, wrapper.isContextReady() else {
            throw WhisperError.contextNotFound
        }

        self.currentJobId = jobId
        self.isAborted = false

        await MainActor.run {
            onTranscribe(["result": "", "segments": [], "isCapturing": true])
        }

        while !self.isAborted {
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        await MainActor.run {
            onEnd(["isCapturing": false])
        }
    }

    func abortTranscribe(jobId: Int) {
        self.isAborted = true
    }

    func detectLanguage(audioPath: String) async throws -> [String: Any] {
        guard let wrapper = wrapper, wrapper.isContextReady() else {
            throw WhisperError.contextNotFound
        }

        // Load audio file
        let audioData = try loadAudioFile(path: audioPath)

        // Convert Float array to NSData
        let audioDataNS = audioData.withUnsafeBufferPointer { bufferPointer in
            NSData(bytes: bufferPointer.baseAddress!, length: audioData.count * MemoryLayout<Float>.stride)
        }

        let rawResult = try wrapper.detectLanguage(
            withState: audioDataNS as Data,
            sampleRate: Int32(Self.sampleRate),
            nThreads: 4
        ) as? [String: Any]

        guard let rawResult = rawResult else {
            throw WhisperError.transcriptionFailed("Language detection returned nil result")
        }

        return [
            "language": rawResult["language"] ?? "unknown",
            "confidence": rawResult["confidence"] ?? 0.0,
            "languageName": rawResult["languageName"] ?? "Unknown"
        ]
    }

    func startChunkedRealtimeTranscribe(
        jobId: Int,
        chunkDurationMs: Int,
        options: [String: Any],
        onChunkComplete: @escaping ([String: Any]) -> Void
    ) async throws {
        guard let wrapper = wrapper, wrapper.isContextReady() else {
            throw WhisperError.contextNotFound
        }

        self.currentJobId = jobId
        self.isAborted = false

        let language = options["language"] as? String
        let translate = options["translate"] as? Bool ?? false
        let maxTokens = options["maxTokens"] as? Int ?? 0


        do {
            try wrapper.startChunkedRealtimeTranscribe(
                withState: Int32(chunkDurationMs),
                samplesPerChunk: Int32((chunkDurationMs * 16000) / 1000),
                language: language,
                translate: translate,
                maxTokens: Int32(maxTokens),
                useVad: false,
                audioContext: 512,
                singleSegment: true,
                noContext: false,
                onChunkComplete: { payload in
                    if let payload = payload as? [String: Any] {
                        var event: [String: Any] = [
                            "contextId": self.contextId,
                            "jobId": jobId,
                            "isCapturing": !self.isAborted,
                        ]
                        event.merge(payload) { _, new in new }
                        onChunkComplete(event)
                    }
                },
                error: nil
            )


            while !self.isAborted {
                try await Task.sleep(nanoseconds: 100_000_000)
            }

        } catch {
            throw WhisperError.transcriptionFailed("Failed to start chunked realtime transcription: \(error.localizedDescription)")
        }
    }

    func release() {
        wrapper?.freeContext()
        wrapper = nil
    }

    private func parseWAVBuffer(audioData: Data) throws -> [Float] {
        guard audioData.count >= 44 else {
            throw WhisperError.transcriptionFailed("Invalid WAV file: too small")
        }

        let audioBytes = [UInt8](audioData.dropFirst(44))
        let shortBuffer = audioBytes.withUnsafeBytes { buffer -> [Int16] in
            Array(buffer.bindMemory(to: Int16.self))
        }

        return shortBuffer.map { Float($0) / 32768.0 }
    }

    private func loadAudioFile(path: String) throws -> [Float] {
        let fileURL = URL(fileURLWithPath: path)
        let audioData = try Data(contentsOf: fileURL)
        return try parseWAVBuffer(audioData: audioData)
    }

    private func resampleAudio(samples: [Float], sourceRate: Double, sourceChannels: Int) throws -> [Float] {
        guard sourceRate == Self.sampleRate else {
            throw WhisperError.transcriptionFailed("Audio resampling not implemented. Expected 16000 Hz, got \(sourceRate)")
        }
        return samples
    }

    func startBufferRecording(maxDurationSeconds: Int = 30) throws -> String {
        audioBufferManager = AudioBufferManager()
        do {
            try audioBufferManager?.startRecording()
            return "buffer_\(UUID().uuidString)"
        } catch {
            throw WhisperError.transcriptionFailed("Failed to start buffer recording: \(error.localizedDescription)")
        }
    }

    func stopBufferRecording() throws -> Data {
        guard let manager = audioBufferManager else {
            throw WhisperError.transcriptionFailed("No buffer recording in progress")
        }

        do {
            guard let wavData = try manager.stopRecording() else {
                throw WhisperError.transcriptionFailed("Failed to get recorded audio data")
            }
            return wavData
        } catch {
            throw WhisperError.transcriptionFailed("Buffer recording error: \(error.localizedDescription)")
        }
    }

    func transcribeBufferRecording(
        jobId: Int,
        options: [String: Any],
        onProgress: ((Int) -> Void)?,
        onNewSegments: (([String: Any]) -> Void)?
    ) async throws -> [String: Any] {
        guard let wrapper = wrapper, wrapper.isContextReady() else {
            throw WhisperError.contextNotFound
        }

        do {
            let recordingId = try startBufferRecording()
            let wavData = try stopBufferRecording()

            let floatArray = try parseWAVBuffer(audioData: wavData)

            let audioDataNS = floatArray.withUnsafeBufferPointer { bufferPointer in
                NSData(bytes: bufferPointer.baseAddress!, length: floatArray.count * MemoryLayout<Float>.stride)
            }

            let language = options["language"] as? String
            let translate = options["translate"] as? Bool ?? false
            let maxTokens = options["maxTokens"] as? Int ?? 0

            let progressCb: WhisperProgressCallback? = onProgress != nil ? { progress in
                onProgress?(Int(progress))
            } : nil

            let segmentCb: WhisperNewSegmentCallback? = onNewSegments != nil ? { text, startTime, endTime in
                onNewSegments?([
                    "text": text as Any,
                    "t0": startTime,
                    "t1": endTime
                ])
            } : nil

            let rawResult: [AnyHashable: Any]?
            do {
                rawResult = try wrapper.transcribeAudioSamples(
                    audioDataNS as Data,
                    sampleRate: Int32(Self.sampleRate),
                    language: language,
                    translate: translate,
                    maxTokens: Int32(maxTokens),
                    progressCallback: progressCb,
                    newSegmentCallback: segmentCb
                )
            } catch {
                throw WhisperError.transcriptionFailed(error.localizedDescription)
            }

            guard let rawResult = rawResult else {
                throw WhisperError.transcriptionFailed("Transcription returned nil result")
            }

            var result: [String: Any] = [:]
            for (key, value) in rawResult {
                if let stringKey = key as? String {
                    result[stringKey] = value
                }
            }

            return [
                "result": result["result"] ?? "",
                "segments": result["segments"] ?? [],
                "isAborted": false,
                "recordingId": recordingId
            ]
        } catch {
            throw WhisperError.transcriptionFailed("Buffer recording transcription failed: \(error.localizedDescription)")
        }
    }
}