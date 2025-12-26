import Foundation
import AVFoundation

/**
 * In-memory audio buffer manager that captures audio without writing to disk
 * Uses AVAudioEngine for real-time audio capture directly to memory
 */
class AudioBufferManager: NSObject {
    private let audioEngine: AVAudioEngine
    private var isRecording = false

    private var recordedData = Data()
    private let lock = NSLock()

    private var samplesCaptured: Int64 = 0
    private var tapCallbacks: Int = 0

    private var audioConverter: AVAudioConverter?
    
    override init() {
        audioEngine = AVAudioEngine()
        super.init()
    }

    func startRecording() throws {
        let audioSession = AVAudioSession.sharedInstance()

        NSLog("[AudioBufferManager] Configuring audio session...")

        if let inputs = audioSession.availableInputs, inputs.isEmpty {
             NSLog("[AudioBufferManager] ERROR: No audio inputs available! Simulator microphone may be disconnected.")
        } else {
             NSLog("[AudioBufferManager] Available inputs: \(audioSession.availableInputs?.description ?? "none")")
        }

        try audioSession.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker, .allowBluetooth])
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        if audioEngine.isRunning {
             NSLog("[AudioBufferManager] Warning: Engine was already running, stopping it.")
             audioEngine.stop()
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        
        let inputNode = audioEngine.inputNode
        let inputFormat = inputNode.inputFormat(forBus: 0)
        
        NSLog("[AudioBufferManager] Node Input Format: \(inputFormat)")
        
        if inputFormat.sampleRate == 0 {
             throw NSError(domain: "AudioBufferManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid input sample rate (0Hz). Simulator audio hardware is likely unavailable."])
        }

        guard let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false) else {
            throw NSError(domain: "AudioBufferManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create output format"])
        }

        guard let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else {
            throw NSError(domain: "AudioBufferManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio converter"])
        }
        self.audioConverter = converter

        lock.lock()
        recordedData = Data()
        samplesCaptured = 0
        tapCallbacks = 0
        lock.unlock()

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] (buffer, time) in
            guard let self = self else { return }
            guard let converter = self.audioConverter else { return }

            self.tapCallbacks += 1

            if self.tapCallbacks % 10 == 0 {
                let channelData = buffer.floatChannelData?[0]
                var sum: Float = 0
                if let data = channelData {
                    for i in 0..<Int(buffer.frameLength) {
                        sum += abs(data[i])
                    }
                }
                let avg = sum / Float(buffer.frameLength)
                NSLog("[AudioBufferManager] Tap callback #%d. Input Avg Amplitude: %f", self.tapCallbacks, avg)
                if avg == 0 {
                    NSLog("[AudioBufferManager] WARNING: Input buffer is PURE SILENCE. Check Simulator Mic access.")
                }
            }

            let inputFrameCount = buffer.frameLength
            let ratio = 16000.0 / inputFormat.sampleRate
            let capacity = AVAudioFrameCount(Double(inputFrameCount) * ratio)
            
            guard let outputBuffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }
            
            var error: NSError? = nil
            let inputBlock: AVAudioConverterInputBlock = { inNumPackets, outStatus in
                outStatus.pointee = .haveData
                return buffer
            }
            
            converter.convert(to: outputBuffer, error: &error, withInputFrom: inputBlock)
            
            if let error = error {
                NSLog("[AudioBufferManager] Conversion error: %@", error.localizedDescription)
                return
            }

            self.appendFloatBufferAsInt16(outputBuffer)
        }

        NSLog("[AudioBufferManager] Starting engine...")
        audioEngine.prepare()

        var retries = 3
        var started = false
        var lastError: Error?

        while retries > 0 && !started {
            do {
                Thread.sleep(forTimeInterval: 0.1)
                try audioEngine.start()
                started = true
                NSLog("[AudioBufferManager] Engine started successfully.")
            } catch {
                lastError = error
                retries -= 1
                NSLog("[AudioBufferManager] WARNING: Engine start failed, retrying (%d left)... Error: %@", retries, error.localizedDescription)
            }
        }

        if !started {
            throw lastError ?? NSError(domain: "AudioBufferManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to start audio engine after multiple retries"])
        }

        isRecording = true
        NSLog("[AudioBufferManager] Recording active. Engine isRunning: %d", audioEngine.isRunning ? 1 : 0)
    }

    private func appendFloatBufferAsInt16(_ buffer: AVAudioPCMBuffer) {
        guard let floatChannelData = buffer.floatChannelData else { return }
        let frameLength = Int(buffer.frameLength)
        let channelData = floatChannelData[0]

        let bytesPerSample = MemoryLayout<Int16>.size
        var tempBuffer = Data(count: frameLength * bytesPerSample)
        
        tempBuffer.withUnsafeMutableBytes { targetBytes in
            let targetPointer = targetBytes.bindMemory(to: Int16.self).baseAddress!
            for i in 0..<frameLength {
                let sample = channelData[i]
                let val = max(-1.0, min(1.0, sample))
                targetPointer[i] = Int16(val * 32767.0)
            }
        }
        
        lock.lock()
        recordedData.append(tempBuffer)
        samplesCaptured += Int64(frameLength)
        lock.unlock()
    }

    func getCurrentRecordingData() -> Data {
        lock.lock()
        let data = recordedData
        lock.unlock()
        return data
    }

    func getCurrentAudioLevel() -> Double {
        lock.lock()
        defer { lock.unlock() }

        guard !recordedData.isEmpty else { return 0.0 }

        let bytesPerSample = 2
        let recentChunkSize = min(2048 * bytesPerSample, recordedData.count)
        let recentData = recordedData.subdata(in: max(0, recordedData.count - recentChunkSize)..<recordedData.count)

        var sumSquares: Double = 0
        recentData.withUnsafeBytes { rawBuffer in
            let samples = rawBuffer.bindMemory(to: Int16.self)
            for sample in samples {
                let floatSample = Double(sample) / 32768.0
                sumSquares += floatSample * floatSample
            }
        }

        let sampleCount = recentData.count / bytesPerSample
        guard sampleCount > 0 else { return 0.0 }

        let rms = sqrt(sumSquares / Double(sampleCount))
        return min(1.0, rms)
    }

    func stopRecording() throws -> Data? {
        if !isRecording { return nil }

        NSLog("[AudioBufferManager] Stopping recording. Callbacks received: %d, Samples captured: %lld", tapCallbacks, samplesCaptured)

        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine.stop()
        isRecording = false
        audioConverter = nil

        lock.lock()
        let pcmData = recordedData
        recordedData = Data()
        lock.unlock()
        
        if pcmData.isEmpty {
            NSLog("[AudioBufferManager] WARNING: No audio data captured!")
            return nil
        }

        let totalSamples = pcmData.count / 2
        var sumSquares: Double = 0
        pcmData.withUnsafeBytes { rawBuffer in
            let samples = rawBuffer.bindMemory(to: Int16.self)
            let step = max(1, totalSamples / 1000)
            for i in stride(from: 0, to: totalSamples, by: step) {
                let val = Double(samples[i])
                sumSquares += val * val
            }
            let countChecked = Double(totalSamples) / Double(step)
            let rms = sqrt(sumSquares / countChecked)
            NSLog("[AudioBufferManager] Captured %d bytes. Average RMS Amplitude: %f", pcmData.count, rms)
            if rms < 50 {
                 NSLog("[AudioBufferManager] WARNING: Captured audio is SILENT.")
            }
        }

        return encodePCMToWAV(pcmData)
    }

    private func encodePCMToWAV(_ pcmData: Data) -> Data {
        let sampleRate: UInt32 = 16000
        let channels: UInt16 = 1
        let bitsPerSample: UInt16 = 16
        let byteRate = sampleRate * UInt32(channels) * UInt32(bitsPerSample / 8)
        let blockAlign = UInt16(channels) * (bitsPerSample / 8)

        var wavData = Data()

        wavData.append(contentsOf: "RIFF".data(using: .ascii)!)
        let fileSize = UInt32(36 + pcmData.count)
        wavData.append(contentsOf: withUnsafeBytes(of: fileSize) { Data($0) })
        wavData.append(contentsOf: "WAVE".data(using: .ascii)!)

        wavData.append(contentsOf: "fmt ".data(using: .ascii)!)
        wavData.append(contentsOf: withUnsafeBytes(of: UInt32(16)) { Data($0) })
        wavData.append(contentsOf: withUnsafeBytes(of: UInt16(1)) { Data($0) })
        wavData.append(contentsOf: withUnsafeBytes(of: channels) { Data($0) })
        wavData.append(contentsOf: withUnsafeBytes(of: sampleRate) { Data($0) })
        wavData.append(contentsOf: withUnsafeBytes(of: byteRate) { Data($0) })
        wavData.append(contentsOf: withUnsafeBytes(of: blockAlign) { Data($0) })
        wavData.append(contentsOf: withUnsafeBytes(of: bitsPerSample) { Data($0) })

        wavData.append(contentsOf: "data".data(using: .ascii)!)
        wavData.append(contentsOf: withUnsafeBytes(of: UInt32(pcmData.count)) { Data($0) })
        wavData.append(pcmData)

        return wavData
    }
}
