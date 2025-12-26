package expo.modules.whisper

import android.util.Log
import java.io.File

class WhisperContext(
    val id: Int,
    private val modelPath: String
) {
    private var contextPtr: Long = 0
    
    init {
        val file = File(modelPath)
        if (!file.exists()) {
            throw Exception("Model file not found at $modelPath")
        }
        
        Log.d("WhisperContext", "Initializing context with model: $modelPath")
        contextPtr = initContext(modelPath)
        
        if (contextPtr == 0L) {
            throw Exception("Failed to initialize Whisper context")
        }
    }

    fun release() {
        if (contextPtr != 0L) {
            freeContext(contextPtr)
            contextPtr = 0
        }
    }

    fun transcribeBuffer(
        audioData: ByteArray,
        language: String = "auto",
        translate: Boolean = false,
        maxTokens: Int = 0,
        suppressBlank: Boolean = true,
        suppressNst: Boolean = true
    ): String {
        if (contextPtr == 0L) {
            throw Exception("Context is released")
        }

        return fullTranscribe(
            contextPtr,
            audioData,
            language,
            translate,
            maxTokens,
            suppressBlank,
            suppressNst
        )
    }

    companion object {
        init {
            System.loadLibrary("whisper-jni")
        }

        @JvmStatic
        private external fun initContext(modelPath: String): Long

        @JvmStatic
        private external fun freeContext(contextPtr: Long)

        @JvmStatic
        private external fun fullTranscribe(
            contextPtr: Long,
            audioData: ByteArray,
            language: String = "auto",
            translate: Boolean = false,
            maxTokens: Int = 0,
            suppressBlank: Boolean = true,
            suppressNst: Boolean = true
        ): String
    }
}
