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

        let audioData = try loadAudioFile(path: audioPath)

        let audioDataNS = audioData.withUnsafeBufferPointer { bufferPointer in
            NSData(bytes: bufferPointer.baseAddress!, length: audioData.count * MemoryLayout<Float>.stride)
        }

        let language = options["language"] as? String
        let translate = options["translate"] as? Bool ?? false
        let maxTokens = options["maxTokens"] as? Int ?? 0
        let suppressBlank = options["suppressBlank"] as? Bool ?? true
        let suppressNst = options["suppressNst"] as? Bool ?? true

        let progressCb: WhisperProgressCallback? = onProgress != nil ? { progress in
            onProgress?(Int(progress))
        } : nil

        let segmentCb: WhisperNewSegmentCallback? = onNewSegments != nil ? { text, startTime, endTime in
            onNewSegments?([
                "text": text as Any,
                "start": startTime,
                "end": endTime
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
                suppressBlank: suppressBlank,
                suppressNst: suppressNst,
                progressCallback: progressCb,
                newSegmentCallback: segmentCb
            )
        } catch {
            throw WhisperError.transcriptionFailed(error.localizedDescription)
        }

        if self.isAborted {
            return [
                "text": "",
                "segments": [] as [[String: Any]],
                "isAborted": true
            ]
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
            "text": result["result"] ?? "",
            "segments": result["segments"] ?? [],
            "isAborted": false
        ]
    }

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

        let floatArray = try parseWAVBuffer(audioData: audioData)

        guard floatArray.count > 0 else {
            throw WhisperError.transcriptionFailed("No audio data in buffer")
        }

        if floatArray.count < 8000 {
            return [
                "text": "",
                "segments": [] as [[String: Any]],
                "isAborted": false,
                "reason": "Audio too short (minimum 0.5 seconds required)"
            ]
        }

        let audioDataNS = floatArray.withUnsafeBufferPointer { bufferPointer in
            NSData(bytes: bufferPointer.baseAddress!, length: floatArray.count * MemoryLayout<Float>.stride)
        }

        let language = options["language"] as? String
        let translate = options["translate"] as? Bool ?? false
        let maxTokens = options["maxTokens"] as? Int ?? 0
        let suppressBlank = options["suppressBlank"] as? Bool ?? true
        let suppressNst = options["suppressNst"] as? Bool ?? true

        let progressCb: WhisperProgressCallback? = onProgress != nil ? { progress in
            onProgress?(Int(progress))
        } : nil

        let segmentCb: WhisperNewSegmentCallback? = onNewSegments != nil ? { text, startTime, endTime in
            onNewSegments?([
                "text": text as Any,
                "start": startTime,
                "end": endTime
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
                suppressBlank: suppressBlank,
                suppressNst: suppressNst,
                progressCallback: progressCb,
                newSegmentCallback: segmentCb
            )
        } catch {
            throw WhisperError.transcriptionFailed(error.localizedDescription)
        }

        if self.isAborted {
            return [
                "text": "",
                "segments": [] as [[String: Any]],
                "isAborted": true
            ]
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
            "text": result["result"] ?? "",
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

        if audioBufferManager == nil {
            audioBufferManager = AudioBufferManager()
        }

        do {
            try audioBufferManager?.startRecording()
            NSLog("[WhisperContext] Started realtime buffer recording")

            await MainActor.run {
                onTranscribe(["result": "", "segments": [], "isCapturing": true])
            }

            let language = options["language"] as? String
            let translate = options["translate"] as? Bool ?? false
            let maxTokens = options["maxTokens"] as? Int ?? 0
            let suppressBlank = options["suppressBlank"] as? Bool ?? true
            let suppressNst = options["suppressNst"] as? Bool ?? true

            var lastTranscribedSize: Int = 0
            let pollIntervalMs: UInt64 = 500

            while !self.isAborted {
                try await Task.sleep(nanoseconds: pollIntervalMs * 1_000_000)

                let currentData = audioBufferManager?.getCurrentRecordingData() ?? Data()
                let currentSize = currentData.count

                if currentSize > lastTranscribedSize {
                    NSLog("[WhisperContext] Polling: got \(currentSize) bytes (was \(lastTranscribedSize)), new chunk: \(currentSize - lastTranscribedSize) bytes")

                    let newChunk = currentData.subdata(in: lastTranscribedSize..<currentSize)

                    do {
                        let floatArray = try parseWAVBuffer(audioData: newChunk)

                        let audioLevel = calculateAudioEnergy(floatArray)

                        DispatchQueue.main.async {
                            onTranscribe([
                                "contextId": self.contextId,
                                "jobId": jobId,
                                "audioLevel": audioLevel,
                                "isCapturing": true
                            ])
                        }

                        let audioDataNS = floatArray.withUnsafeBufferPointer { bufferPointer in
                            NSData(bytes: bufferPointer.baseAddress!, length: floatArray.count * MemoryLayout<Float>.stride)
                        }

                        let result = try wrapper.transcribeAudioSamples(
                            audioDataNS as Data,
                            sampleRate: Int32(Self.sampleRate),
                            language: language,
                            translate: translate,
                            maxTokens: Int32(maxTokens),
                            suppressBlank: suppressBlank,
                            suppressNst: suppressNst,
                            progressCallback: nil,
                            newSegmentCallback: { text, startTime, endTime in
                                NSLog("[WhisperContext] Segment received: text='%@', start=%lld, end=%lld", text, startTime, endTime)
                                let segment: [String: Any] = [
                                    "text": text,
                                    "start": startTime,
                                    "end": endTime
                                ]

                                DispatchQueue.main.async {
                                    NSLog("[WhisperContext] Sending segment event to JS")
                                    onTranscribe([
                                        "contextId": self.contextId,
                                        "jobId": jobId,
                                        "segments": [segment],
                                        "isCapturing": true
                                    ])
                                }
                            }
                        )

                        lastTranscribedSize = currentSize
                    } catch {
                        NSLog("[WhisperContext] Chunk transcription error: %@", error.localizedDescription)
                    }
                }
            }

            NSLog("[WhisperContext] Stopping realtime recording")
            guard let finalWavData = try audioBufferManager?.stopRecording() else {
                throw WhisperError.transcriptionFailed("Failed to get final audio")
            }

            NSLog("[WhisperContext] Final audio size: \(finalWavData.count) bytes")

        } catch {
            throw WhisperError.transcriptionFailed("Realtime transcription failed: \(error.localizedDescription)")
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
        let suppressBlank = options["suppressBlank"] as? Bool ?? true
        let suppressNst = options["suppressNst"] as? Bool ?? true


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
        let bytes = [UInt8](audioData)

        let hasWavHeader = bytes.count >= 4 &&
            bytes[0] == 0x52 && // 'R'
            bytes[1] == 0x49 && // 'I'
            bytes[2] == 0x46 && // 'F'
            bytes[3] == 0x46    // 'F'

        let pcmBytes: [UInt8]

        if hasWavHeader {
            guard bytes.count >= 44 else {
                throw WhisperError.transcriptionFailed("Invalid WAV file: too small")
            }
            pcmBytes = Array(bytes.dropFirst(44))
        } else {
            pcmBytes = bytes
        }

        let shortBuffer = pcmBytes.withUnsafeBytes { buffer -> [Int16] in
            Array(buffer.bindMemory(to: Int16.self))
        }

        let floatArray = shortBuffer.map { Float($0) / 32768.0 }

        let maxVal = floatArray.max() ?? 0
        let minVal = floatArray.min() ?? 0
        if maxVal == 0 && minVal == 0 {
            NSLog("[WhisperContext] WARNING: Audio samples are COMPLETELY zero (digital silence).")
        } else {
            NSLog("[WhisperContext] Audio samples contains non-zero data (Max: %f, Min: %f)", maxVal, minVal)
        }
        
        return floatArray
    }

    private func calculateAudioEnergy(_ floatArray: [Float]) -> Double {
        guard !floatArray.isEmpty else { return 0.0 }

        let sumSquares = floatArray.reduce(0.0) { $0 + Double($1) * Double($1) }
        let rms = sqrt(sumSquares / Double(floatArray.count))

        return min(1.0, rms)
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

    func startBufferRecording() throws -> String {
        if audioBufferManager == nil {
            audioBufferManager = AudioBufferManager()
        }

        do {
            try audioBufferManager?.startRecording()
            return "buffer_\(UUID().uuidString)"
        } catch {
            throw WhisperError.transcriptionFailed("Failed to start buffer recording: \(error.localizedDescription)")
        }
    }

    func getBufferRecordingAudioLevel() -> Double {
        return audioBufferManager?.getCurrentAudioLevel() ?? 0.0
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
            let suppressBlank = options["suppressBlank"] as? Bool ?? true
            let suppressNst = options["suppressNst"] as? Bool ?? true

            let progressCb: WhisperProgressCallback? = onProgress != nil ? { progress in
                onProgress?(Int(progress))
            } : nil

            let segmentCb: WhisperNewSegmentCallback? = onNewSegments != nil ? { text, startTime, endTime in
                onNewSegments?([
                    "text": text as Any,
                    "start": startTime,
                    "end": endTime
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
                    suppressBlank: suppressBlank,
                    suppressNst: suppressNst,
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
                "text": result["result"] ?? "",
                "segments": result["segments"] ?? [],
                "isAborted": false,
                "recordingId": recordingId
            ]
        } catch {
            throw WhisperError.transcriptionFailed("Buffer recording transcription failed: \(error.localizedDescription)")
        }
    }
}