package expo.modules.whisper

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * In-memory audio buffer manager for Android
 * Captures microphone audio directly to RAM without disk writes
 * Uses dynamic buffer to handle variable recording durations
 */
class AudioBufferManager(private val maxDurationSeconds: Int = 30) {
    private var audioRecord: AudioRecord? = null
    private var isRecording = false
    private val sampleRate = 16000
    private val channelConfig = AudioFormat.CHANNEL_IN_MONO
    private val audioFormat = AudioFormat.ENCODING_PCM_16BIT
    private val minBufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)

    // Dynamic buffer that grows as needed
    private val audioBuffer = ByteArrayOutputStream()
    private val bufferLock = Any()

    /**
     * Start recording audio directly to memory
     * @return true if started successfully
     */
    fun startRecording(): Boolean {
        if (isRecording) return false

        audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            sampleRate,
            channelConfig,
            audioFormat,
            minBufferSize
        ).apply {
            startRecording()
        }

        isRecording = true
        synchronized(bufferLock) {
            audioBuffer.reset()
        }

        // Start recording thread with proper buffer management
        Thread {
            val tempBuffer = ByteArray(minBufferSize)
            val maxBytes = maxDurationSeconds * sampleRate * 2 // 16-bit = 2 bytes/sample

            while (isRecording) {
                val read = audioRecord?.read(tempBuffer, 0, tempBuffer.size) ?: 0
                if (read > 0) {
                    synchronized(bufferLock) {
                        if (audioBuffer.size() + read <= maxBytes) {
                            audioBuffer.write(tempBuffer, 0, read)
                        } else {
                            // Stop recording if max buffer size reached
                            isRecording = false
                        }
                    }
                }
            }
        }.start()

        return true
    }

    /**
     * Stop recording and return WAV data
     * @return ByteArray containing WAV file data
     */
    fun stopRecording(): ByteArray {
        if (!isRecording) throw IllegalStateException("Not recording")

        isRecording = false
        audioRecord?.stop()
        audioRecord?.release()
        audioRecord = null

        // Get PCM data with thread safety
        val pcmData: ByteArray
        synchronized(bufferLock) {
            pcmData = audioBuffer.toByteArray()
        }

        return encodeToWav(pcmData)
    }

    /**
     * Encode PCM data to WAV format in memory
     */
    private fun encodeToWav(pcmData: ByteArray): ByteArray {
        val wavHeader = createWavHeader(pcmData.size)
        return wavHeader + pcmData
    }

    /**
     * Create WAV header for PCM data
     */
    private fun createWavHeader(dataLength: Int): ByteArray {
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)

        // RIFF chunk
        header.put("RIFF".toByteArray())
        header.putInt(36 + dataLength)
        header.put("WAVE".toByteArray())

        // fmt subchunk
        header.put("fmt ".toByteArray())
        header.putInt(16) // PCM format
        header.putShort(1) // Audio format (PCM)
        header.putShort(1) // Number of channels (mono)
        header.putInt(sampleRate)
        header.putInt(sampleRate * 2) // Byte rate
        header.putShort(2) // Block align
        header.putShort(16) // Bits per sample

        // data subchunk
        header.put("data".toByteArray())
        header.putInt(dataLength)

        return header.array()
    }
}