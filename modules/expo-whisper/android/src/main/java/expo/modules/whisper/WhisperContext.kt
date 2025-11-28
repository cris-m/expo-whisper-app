package expo.modules.whisper

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WhisperContext private constructor(
    private val contextPtr: Long,
    val contextId: Int,
    val isGpuEnabled: Boolean,
    val reasonNoGpu: String
) {
    private var currentJobId: Int = -1
    private var isAborted: Boolean = false
    private var audioBufferManager: AudioBufferManager? = null

    companion object {
        private const val SAMPLE_RATE = 16000

        init {
            System.loadLibrary("whisper")
        }

        fun getLibVersion(): String {
            return "1.0.0"
        }

        fun createContext(
            modelPath: String,
            contextId: Int,
            useGpu: Boolean,
            useFlashAttn: Boolean
        ): WhisperContext {
            val ptr = nativeInitContext(modelPath, useGpu, useFlashAttn)
            if (ptr == 0L) {
                throw RuntimeException("Failed to initialize whisper context from: $modelPath")
            }

            // GPU is not typically available on Android without OpenCL/Vulkan support
            val gpuEnabled = false
            val gpuReason = "GPU not available on Android"

            return WhisperContext(ptr, contextId, gpuEnabled, gpuReason)
        }

        // Native JNI methods
        @JvmStatic
        private external fun nativeInitContext(modelPath: String, useGpu: Boolean, useFlashAttn: Boolean): Long

        @JvmStatic
        private external fun nativeFreeContext(contextPtr: Long)

        @JvmStatic
        private external fun nativeTranscribe(
            contextPtr: Long,
            audioData: FloatArray,
            language: String?,
            translate: Boolean,
            maxTokens: Int
        ): Map<String, Any>?

        @JvmStatic
        private external fun nativeDetectLanguageWithState(
            contextPtr: Long,
            audioData: FloatArray,
            nThreads: Int
        ): Map<String, Any>?
    }

    // FILE TRANSCRIPTION (existing)
    fun transcribe(
        audioPath: String,
        jobId: Int,
        language: String?,
        translate: Boolean,
        maxTokens: Int,
        onProgress: ((Int) -> Unit)?,
        onNewSegments: ((Map<String, Any>) -> Unit)?
    ): Map<String, Any> {
        currentJobId = jobId
        isAborted = false

        val audioData = loadAudioFile(audioPath)

        val result = nativeTranscribe(contextPtr, audioData, language, translate, maxTokens)
            ?: throw RuntimeException("Transcription failed")

        return mapOf(
            "result" to (result["result"] ?: ""),
            "segments" to (result["segments"] ?: emptyList<Map<String, Any>>()),
            "isAborted" to isAborted
        )
    }

    // BUFFER TRANSCRIPTION (new)
    fun transcribeBuffer(
        audioData: ByteArray,
        jobId: Int,
        language: String?,
        translate: Boolean,
        maxTokens: Int
    ): Map<String, Any> {
        currentJobId = jobId
        isAborted = false

        // Parse WAV buffer and extract PCM data
        val pcmData = parseWavBuffer(audioData)

        val result = nativeTranscribe(contextPtr, pcmData, language, translate, maxTokens)
            ?: throw RuntimeException("Buffer transcription failed")

        return mapOf(
            "result" to (result["result"] ?: ""),
            "segments" to (result["segments"] ?: emptyList<Map<String, Any>>()),
            "isAborted" to isAborted
        )
    }

    // BUFFER RECORDING (new)
    fun startBufferRecording(maxDurationSeconds: Int = 30): String {
        audioBufferManager = AudioBufferManager(maxDurationSeconds)
        audioBufferManager?.startRecording()
        return "buffer_${System.currentTimeMillis()}"
    }

    fun stopBufferRecording(): ByteArray {
        val manager = audioBufferManager 
            ?: throw RuntimeException("No buffer recording in progress")
        val wavData = manager.stopRecording()
        audioBufferManager = null
        return wavData
    }

    // LANGUAGE DETECTION
    fun detectLanguage(audioPath: String): Map<String, Any> {
        val audioData = loadAudioFile(audioPath)
        val result = nativeDetectLanguageWithState(contextPtr, audioData, 4)
            ?: throw RuntimeException("Language detection failed")

        return mapOf(
            "language" to (result["language"] ?: "unknown"),
            "confidence" to (result["confidence"] ?: 0.0),
            "languageName" to (result["languageName"] ?: "Unknown")
        )
    }

    fun abortTranscribe(jobId: Int) {
        if (currentJobId == jobId) {
            isAborted = true
        }
    }

    // BUFFER RECORDING + TRANSCRIPTION (Combined)
    fun transcribeBufferRecording(
        jobId: Int,
        language: String?,
        translate: Boolean,
        maxTokens: Int,
        onProgress: ((Int) -> Unit)?,
        onNewSegments: ((Map<String, Any>) -> Unit)?
    ): Map<String, Any> {
        currentJobId = jobId
        isAborted = false

        val recordingId = startBufferRecording()
        val wavData = stopBufferRecording()
        val pcmData = parseWavBuffer(wavData)

        val result = nativeTranscribe(contextPtr, pcmData, language, translate, maxTokens)
            ?: throw RuntimeException("Buffer recording transcription failed")

        return mapOf(
            "result" to (result["result"] ?: ""),
            "segments" to (result["segments"] ?: emptyList<Map<String, Any>>()),
            "isAborted" to isAborted,
            "recordingId" to recordingId
        )
    }

    fun release() {
        nativeFreeContext(contextPtr)
        audioBufferManager = null
    }

    // Helper: Parse WAV buffer
    private fun parseWavBuffer(wavData: ByteArray): FloatArray {
        // Skip WAV header (44 bytes)
        val pcmBytes = wavData.copyOfRange(44, wavData.size)
        val shortBuffer = ByteBuffer.wrap(pcmBytes)
            .order(ByteOrder.LITTLE_ENDIAN)
            .asShortBuffer()
        
        val samples = FloatArray(shortBuffer.remaining())
        for (i in samples.indices) {
            samples[i] = shortBuffer.get(i) / 32768.0f
        }
        return samples
    }

    // Helper: Load audio file
    private fun loadAudioFile(path: String): FloatArray {
        val file = File(path)
        if (!file.exists()) {
            throw RuntimeException("Audio file not found: $path")
        }

        val randomAccessFile = RandomAccessFile(file, "r")
        randomAccessFile.seek(44) // Skip WAV header
        
        val dataSize = (file.length() - 44).toInt()
        val audioBytes = ByteArray(dataSize)
        randomAccessFile.readFully(audioBytes)
        randomAccessFile.close()

        val shortBuffer = ByteBuffer.wrap(audioBytes)
            .order(ByteOrder.LITTLE_ENDIAN)
            .asShortBuffer()
        
        val samples = FloatArray(shortBuffer.remaining())
        for (i in samples.indices) {
            samples[i] = shortBuffer.get(i) / 32768.0f
        }
        return samples
    }
}