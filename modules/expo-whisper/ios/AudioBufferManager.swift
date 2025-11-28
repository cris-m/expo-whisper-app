import Foundation
import AVFoundation

/**
 * In-memory audio buffer manager that captures audio without writing to disk
 * Uses AVAudioEngine for real-time audio capture directly to memory
 */
class AudioBufferManager: NSObject {
    private var audioEngine: AVAudioEngine
    private var audioBuffer: AVAudioPCMBuffer?
    private var isRecording = false
    private var bufferWriteOffset: AVAudioFrameCount = 0
    private var hardwareFormat: AVAudioFormat?

    override init() {
        audioEngine = AVAudioEngine()
        super.init()
    }
    
    func startRecording() throws {
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .default, options: .duckOthers)
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        let inputNode = audioEngine.inputNode

        // Get the hardware's native format (e.g., 44.1kHz or 48kHz)
        let hwFormat = inputNode.outputFormat(forBus: 0)
        self.hardwareFormat = hwFormat

        // Create buffer in hardware format (we'll resample when stopping)
        audioBuffer = AVAudioPCMBuffer(pcmFormat: hwFormat, frameCapacity: AVAudioFrameCount(hwFormat.sampleRate * 30))
        bufferWriteOffset = 0

        // Install tap with NO format parameter (accepts hardware format directly)
        inputNode.installTap(onBus: 0, bufferSize: 4096, format: nil) { [weak self] buffer, _ in
            guard let self = self, let audioBuffer = self.audioBuffer else { return }

            // Append incoming buffer to our recording buffer
            if let incomingData = buffer.floatChannelData,
               let ourData = audioBuffer.floatChannelData {
                let incomingFrames = buffer.frameLength
                let availableSpace = audioBuffer.frameCapacity - self.bufferWriteOffset

                // Only copy if we have space
                guard availableSpace > 0 else {
                    return
                }

                let framesToCopy = min(incomingFrames, availableSpace)
                let offset = Int(self.bufferWriteOffset)

                // Copy incoming audio data to the offset position in our buffer
                memcpy(ourData[0] + offset, incomingData[0], Int(framesToCopy) * MemoryLayout<Float>.stride)

                // Update write offset and total frame length
                self.bufferWriteOffset += framesToCopy
                audioBuffer.frameLength = self.bufferWriteOffset
            }
        }

        try audioEngine.start()
        isRecording = true

    }
    
    func stopRecording() throws -> Data? {
        guard isRecording, let buffer = audioBuffer, let hwFormat = hardwareFormat else {
            return nil
        }

        audioEngine.inputNode.removeTap(onBus: 0)
        try audioEngine.stop()
        isRecording = false

        // Convert from hardware format (e.g., 44.1kHz) to 16kHz mono
        guard let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false) else {
            return nil
        }

        guard let converter = AVAudioConverter(from: hwFormat, to: targetFormat) else {
            throw NSError(domain: "AudioBufferManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Failed to create audio converter"])
        }

        guard let convertedBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: AVAudioFrameCount(targetFormat.sampleRate * 30)) else {
            return nil
        }

        // Perform the conversion
        var error: NSError?
        let inputBlock: AVAudioConverterInputBlock = { _, outStatus in
            outStatus.pointee = .haveData
            return buffer
        }

        let status = converter.convert(to: convertedBuffer, error: &error, withInputFrom: inputBlock)

        guard status != .error else {
            throw NSError(domain: "AudioBufferManager", code: -1, userInfo: [NSLocalizedDescriptionKey: "Audio conversion failed: \(error?.localizedDescription ?? "unknown")"])
        }

        // Encode the converted 16kHz buffer to WAV
        return encodeAudioBufferToWAV(convertedBuffer)
    }
    
    private func encodeAudioBufferToWAV(_ buffer: AVAudioPCMBuffer) -> Data? {
        guard let floatChannelData = buffer.floatChannelData else {
            return nil
        }

        // Enforce 16kHz mono to match Whisper requirements
        let sampleRate: UInt32 = 16000
        let channels: UInt16 = 1
        let frameLength = buffer.frameLength
        
        // WAV header structure
        var wavData = Data()
        
        // RIFF chunk
        wavData.append(contentsOf: "RIFF".data(using: .ascii)!)
        
        let dataSize = frameLength * UInt32(channels) * 2 // 16-bit samples
        let fileSize = 36 + dataSize
        wavData.append(contentsOf: withUnsafeBytes(of: fileSize) { Data($0) })
        
        wavData.append(contentsOf: "WAVE".data(using: .ascii)!)
        
        // fmt sub-chunk
        wavData.append(contentsOf: "fmt ".data(using: .ascii)!)
        wavData.append(contentsOf: withUnsafeBytes(of: UInt32(16)) { Data($0) }) // subchunk1 size
        wavData.append(contentsOf: withUnsafeBytes(of: UInt16(1)) { Data($0) }) // PCM format
        wavData.append(contentsOf: withUnsafeBytes(of: channels) { Data($0) }) // channels
        wavData.append(contentsOf: withUnsafeBytes(of: sampleRate) { Data($0) }) // sample rate
        
        let byteRate = sampleRate * UInt32(channels) * 2
        wavData.append(contentsOf: withUnsafeBytes(of: byteRate) { Data($0) }) // byte rate
        
        let blockAlign: UInt16 = UInt16(channels) * 2
        wavData.append(contentsOf: withUnsafeBytes(of: blockAlign) { Data($0) }) // block align
        wavData.append(contentsOf: withUnsafeBytes(of: UInt16(16)) { Data($0) }) // bits per sample
        
        // data sub-chunk
        wavData.append(contentsOf: "data".data(using: .ascii)!)
        wavData.append(contentsOf: withUnsafeBytes(of: dataSize) { Data($0) })
        
        // Audio samples (convert from float to 16-bit PCM)
        let floatData = floatChannelData[0]
        for i in 0..<Int(frameLength) {
            let floatSample = floatData[i]
            let int16Sample = Int16(floatSample * 32767.0)
            wavData.append(contentsOf: withUnsafeBytes(of: int16Sample) { Data($0) })
        }
        
        return wavData
    }
}