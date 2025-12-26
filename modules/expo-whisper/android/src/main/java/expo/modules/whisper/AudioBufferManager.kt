package expo.modules.whisper

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

class AudioBufferManager {
    private var audioRecord: AudioRecord? = null
    private var isRecording = AtomicBoolean(false)
    private var recordingThread: Thread? = null
    private val recordedData = ByteArrayOutputStream()

    @SuppressLint("MissingPermission")
    fun startRecording(): String {
        if (isRecording.get()) {
            stopRecording()
        }

        val sampleRate = 16000
        val channelConfig = AudioFormat.CHANNEL_IN_MONO
        val audioFormat = AudioFormat.ENCODING_PCM_16BIT
        
        val minBufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
        val bufferSize = Math.max(minBufferSize, 4096)

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                channelConfig,
                audioFormat,
                bufferSize
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                throw IOException("AudioRecord failed to initialize")
            }

            recordedData.reset()
            isRecording.set(true)
            audioRecord?.startRecording()

            recordingThread = Thread {
                val buffer = ShortArray(bufferSize / 2)

                while (isRecording.get()) {
                    val readResult = audioRecord?.read(buffer, 0, buffer.size) ?: -1
                    if (readResult > 0) {
                        val byteBuffer = ByteBuffer.allocate(readResult * 2)
                        byteBuffer.order(ByteOrder.LITTLE_ENDIAN)
                        for (i in 0 until readResult) {
                            byteBuffer.putShort(buffer[i])
                        }
                        synchronized(recordedData) {
                            recordedData.write(byteBuffer.array())
                        }
                    }
                }
            }
            recordingThread?.start()

            return "buffer_${System.currentTimeMillis()}"
        } catch (e: Exception) {
            isRecording.set(false)
            throw IOException("Failed to start recording: ${e.message}")
        }
    }

    fun stopRecording(): String? {
        if (!isRecording.get()) return null

        isRecording.set(false)
        try {
            recordingThread?.join(1000)
        } catch (e: InterruptedException) {
            e.printStackTrace()
        }

        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        audioRecord = null
        recordingThread = null

        val pcmData: ByteArray
        synchronized(recordedData) {
            pcmData = recordedData.toByteArray()
            recordedData.reset()
        }

        if (pcmData.isEmpty()) {
            return null
        }

        val wavData = encodePCMToWAV(pcmData)
        return Base64.encodeToString(wavData, Base64.NO_WRAP)
    }

    private fun encodePCMToWAV(pcmData: ByteArray): ByteArray {
        val sampleRate = 16000
        val channels = 1
        val bitsPerSample = 16
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign = channels * bitsPerSample / 8
        
        val headerSize = 44
        val totalDataLen = pcmData.size + headerSize - 8
        val totalAudioLen = pcmData.size

        val header = ByteBuffer.allocate(headerSize)
        header.order(ByteOrder.LITTLE_ENDIAN)

        header.put("RIFF".toByteArray(Charsets.US_ASCII))
        header.putInt(totalDataLen)
        header.put("WAVE".toByteArray(Charsets.US_ASCII))

        header.put("fmt ".toByteArray(Charsets.US_ASCII))
        header.putInt(16)
        header.putShort(1.toShort())
        header.putShort(channels.toShort())
        header.putInt(sampleRate)
        header.putInt(byteRate)
        header.putShort(blockAlign.toShort())
        header.putShort(bitsPerSample.toShort())

        header.put("data".toByteArray(Charsets.US_ASCII))
        header.putInt(totalAudioLen)

        val wavStream = ByteArrayOutputStream()
        try {
            wavStream.write(header.array())
            wavStream.write(pcmData)
        } catch (e: IOException) {
            e.printStackTrace()
        }

        return wavStream.toByteArray()
    }
}
