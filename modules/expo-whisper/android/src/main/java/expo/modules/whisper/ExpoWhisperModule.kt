package expo.modules.whisper

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import androidx.core.app.ActivityCompat
import android.util.Base64

class ExpoWhisperModule : Module() {
    private val contexts = mutableMapOf<Int, WhisperContext>()
    private var nextContextId = 1
    private val scope = CoroutineScope(Dispatchers.Default)

    override fun definition() = ModuleDefinition {
        Name("ExpoWhisper")

        Events(
            "onTranscribeProgress",
            "onTranscribeNewSegments",
            "onRealtimeTranscribe",
            "onRealtimeTranscribeEnd",
            "onChunkedRealtimeChunkComplete"
        )

        Function("getLibVersion") {
            WhisperContext.getLibVersion()
        }

        // PERMISSIONS
        AsyncFunction("requestMicrophonePermission") { promise: Promise ->
            try {
                val context = appContext.reactContext ?: throw Exception("React context not available")
                val permission = Manifest.permission.RECORD_AUDIO

                val hasPermission = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

                if (hasPermission) {
                    promise.resolve(true)
                } else {
                    val activity = appContext.currentActivity
                    if (activity != null) {
                        ActivityCompat.requestPermissions(activity, arrayOf(permission), 100)
                        promise.resolve(true)
                    } else {
                        promise.resolve(false)
                    }
                }
            } catch (e: Exception) {
                promise.reject(CodedException("ERR_PERMISSION", e.message ?: "Failed to request microphone permission", e))
            }
        }

        AsyncFunction("getMicrophonePermissionStatus") { promise: Promise ->
            try {
                val context = appContext.reactContext ?: throw Exception("React context not available")
                val permission = Manifest.permission.RECORD_AUDIO
                val hasPermission = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
                promise.resolve(hasPermission)
            } catch (e: Exception) {
                promise.reject(CodedException("ERR_PERMISSION_CHECK", e.message ?: "Failed to check microphone permission", e))
            }
        }

        // CONTEXT MANAGEMENT
        AsyncFunction("initContext") { options: Map<String, Any?>, promise: Promise ->
            scope.launch {
                try {
                    val filePath = options["filePath"] as? String
                        ?: throw CodedException("ERR_INVALID_PATH", "filePath is required", null)

                    val useGpu = options["useGpu"] as? Boolean ?: false
                    val useFlashAttn = options["useFlashAttn"] as? Boolean ?: false

                    val contextId = nextContextId++

                    val context = WhisperContext.createContext(
                        modelPath = filePath,
                        contextId = contextId,
                        useGpu = useGpu,
                        useFlashAttn = useFlashAttn
                    )

                    contexts[contextId] = context

                    withContext(Dispatchers.Main) {
                        promise.resolve(mapOf(
                            "contextId" to contextId,
                            "gpu" to context.isGpuEnabled,
                            "reasonNoGPU" to context.reasonNoGpu
                        ))
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        promise.reject(CodedException("ERR_INIT_CONTEXT", e.message ?: "Failed to initialize context", e))
                    }
                }
            }
        }

        AsyncFunction("releaseContext") { contextId: Int, promise: Promise ->
            scope.launch {
                try {
                    contexts[contextId]?.release()
                    contexts.remove(contextId)
                    withContext(Dispatchers.Main) {
                        promise.resolve(null)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        promise.reject(CodedException("ERR_RELEASE_CONTEXT", e.message ?: "Failed to release context", e))
                    }
                }
            }
        }

        AsyncFunction("releaseAllContexts") { promise: Promise ->
            scope.launch {
                try {
                    contexts.values.forEach { it.release() }
                    contexts.clear()
                    withContext(Dispatchers.Main) {
                        promise.resolve(null)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        promise.reject(CodedException("ERR_RELEASE_ALL", e.message ?: "Failed to release all contexts", e))
                    }
                }
            }
        }

        // FILE TRANSCRIPTION
        AsyncFunction("transcribeFile") { contextId: Int, jobId: Int, filePath: String, options: Map<String, Any?>, promise: Promise ->
            scope.launch {
                try {
                    val context = contexts[contextId]
                        ?: throw CodedException("ERR_CONTEXT_NOT_FOUND", "Context not found", null)

                    val language = options["language"] as? String ?: "auto"
                    val translate = options["translate"] as? Boolean ?: false
                    val maxTokens = (options["maxTokens"] as? Number)?.toInt() ?: 0
                    val temperature = (options["temperature"] as? Number)?.toDouble() ?: 0.0
                    val initialPrompt = options["initialPrompt"] as? String
                    val tokenTimestamps = options["tokenTimestamps"] as? Boolean ?: false
                    val suppressBlank = options["suppressBlank"] as? Boolean ?: true
                    val suppressNst = options["suppressNst"] as? Boolean ?: true
                    val samplingStrategy = options["samplingStrategy"] as? String ?: "greedy"
                    val beamSize = (options["beamSearchBeamSize"] as? Number)?.toInt() ?: 5

                    val onProgress = options["onProgress"] as? Boolean ?: false
                    val onNewSegments = options["onNewSegments"] as? Boolean ?: false

                    val progressCallback: ((Int) -> Unit)? = if (onProgress) { progress ->
                        sendEvent("onTranscribeProgress", mapOf(
                            "contextId" to contextId,
                            "jobId" to jobId,
                            "progress" to progress
                        ))
                    } else null

                    val segmentCallback: ((Map<String, Any>) -> Unit)? = if (onNewSegments) { result ->
                        sendEvent("onTranscribeNewSegments", mapOf(
                            "contextId" to contextId,
                            "jobId" to jobId,
                            "result" to result
                        ))
                    } else null

                    val enhancedOptions = mapOf(
                        "language" to language,
                        "translate" to translate,
                        "maxTokens" to maxTokens,
                        "temperature" to temperature,
                        "initialPrompt" to initialPrompt,
                        "tokenTimestamps" to tokenTimestamps,
                        "suppressBlank" to suppressBlank,
                        "suppressNst" to suppressNst,
                        "samplingStrategy" to samplingStrategy,
                        "beamSize" to beamSize
                    )

                    val result = context.transcribe(
                        audioPath = filePath,
                        jobId = jobId,
                        language = language,
                        translate = translate,
                        maxTokens = maxTokens,
                        onProgress = progressCallback,
                        onNewSegments = segmentCallback
                    )

                    withContext(Dispatchers.Main) {
                        promise.resolve(result)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        promise.reject(CodedException("ERR_TRANSCRIBE", e.message ?: "Transcription failed", e))
                    }
                }
            }
        }

        // BUFFER TRANSCRIPTION (PURE MEMORY MODE)
        AsyncFunction("transcribeBuffer") { contextId: Int, jobId: Int, audioData: String, options: Map<String, Any?>, promise: Promise ->
            scope.launch {
                try {
                    val context = contexts[contextId]
                        ?: throw CodedException("ERR_CONTEXT_NOT_FOUND", "Context not found", null)

                    val language = options["language"] as? String ?: "auto"
                    val translate = options["translate"] as? Boolean ?: false
                    val maxTokens = (options["maxTokens"] as? Number)?.toInt() ?: 0
                    val temperature = (options["temperature"] as? Number)?.toDouble() ?: 0.0
                    val initialPrompt = options["initialPrompt"] as? String
                    val tokenTimestamps = options["tokenTimestamps"] as? Boolean ?: false
                    val suppressBlank = options["suppressBlank"] as? Boolean ?: true
                    val suppressNst = options["suppressNst"] as? Boolean ?: true
                    val samplingStrategy = options["samplingStrategy"] as? String ?: "greedy"
                    val beamSize = (options["beamSearchBeamSize"] as? Number)?.toInt() ?: 5

                    // Decode base64 to ByteArray
                    val data = Base64.decode(audioData, Base64.DEFAULT)

                    val enhancedOptions = mapOf(
                        "language" to language,
                        "translate" to translate,
                        "maxTokens" to maxTokens,
                        "temperature" to temperature,
                        "initialPrompt" to initialPrompt,
                        "tokenTimestamps" to tokenTimestamps,
                        "suppressBlank" to suppressBlank,
                        "suppressNst" to suppressNst,
                        "samplingStrategy" to samplingStrategy,
                        "beamSize" to beamSize
                    )

                    val result = context.transcribeBuffer(
                        audioData = data,
                        jobId = jobId,
                        language = language,
                        translate = translate,
                        maxTokens = maxTokens
                    )

                    withContext(Dispatchers.Main) {
                        promise.resolve(result)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        promise.reject(CodedException("ERR_TRANSCRIBE_BUFFER", e.message ?: "Buffer transcription failed", e))
                    }
                }
            }
        }

        // BUFFER RECORDING (MICROPHONE → MEMORY)
        AsyncFunction("startBufferRecording") { contextId: Int, maxDurationSeconds: Int?, promise: Promise ->
            scope.launch {
                try {
                    val context = contexts[contextId]
                        ?: throw CodedException("ERR_CONTEXT_NOT_FOUND", "Context not found", null)

                    val recordingId = context.startBufferRecording(maxDurationSeconds ?: 30)

                    withContext(Dispatchers.Main) {
                        promise.resolve(recordingId)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        promise.reject(CodedException("ERR_START_BUFFER", e.message ?: "Failed to start buffer recording", e))
                    }
                }
            }
        }

        AsyncFunction("stopBufferRecording") { contextId: Int, promise: Promise ->
            scope.launch {
                try {
                    val context = contexts[contextId]
                        ?: throw CodedException("ERR_CONTEXT_NOT_FOUND", "Context not found", null)
                    
                    val wavData = context.stopBufferRecording()
                    val base64String = Base64.encodeToString(wavData, Base64.DEFAULT)
                    
                    withContext(Dispatchers.Main) {
                        promise.resolve(base64String)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        promise.reject(CodedException("ERR_STOP_BUFFER", e.message ?: "Failed to stop buffer recording", e))
                    }
                }
            }
        }

        // BUFFER RECORDING + TRANSCRIPTION
        AsyncFunction("transcribeBufferRecording") { contextId: Int, jobId: Int, options: Map<String, Any?>, promise: Promise ->
            scope.launch {
                try {
                    val context = contexts[contextId]
                        ?: throw CodedException("ERR_CONTEXT_NOT_FOUND", "Context not found", null)

                    val language = options["language"] as? String ?: "auto"
                    val translate = options["translate"] as? Boolean ?: false
                    val maxTokens = (options["maxTokens"] as? Number)?.toInt() ?: 0
                    val onProgress = options["onProgress"] as? Boolean ?: false
                    val onNewSegments = options["onNewSegments"] as? Boolean ?: false

                    val progressCallback: ((Int) -> Unit)? = if (onProgress) { progress ->
                        sendEvent("onTranscribeProgress", mapOf(
                            "contextId" to contextId,
                            "jobId" to jobId,
                            "progress" to progress
                        ))
                    } else null

                    val segmentCallback: ((Map<String, Any>) -> Unit)? = if (onNewSegments) { result ->
                        sendEvent("onTranscribeNewSegments", mapOf(
                            "contextId" to contextId,
                            "jobId" to jobId,
                            "result" to result
                        ))
                    } else null

                    val result = context.transcribeBufferRecording(
                        jobId = jobId,
                        language = language,
                        translate = translate,
                        maxTokens = maxTokens,
                        onProgress = progressCallback,
                        onNewSegments = segmentCallback
                    )

                    withContext(Dispatchers.Main) {
                        promise.resolve(result)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        promise.reject(CodedException("ERR_TRANSCRIBE_BUFFER_RECORDING", e.message ?: "Buffer recording transcription failed", e))
                    }
                }
            }
        }

        // LANGUAGE DETECTION
        AsyncFunction("detectLanguage") { contextId: Int, filePath: String, promise: Promise ->
            scope.launch {
                try {
                    val context = contexts[contextId]
                        ?: throw CodedException("ERR_CONTEXT_NOT_FOUND", "Context not found", null)

                    val result = context.detectLanguage(filePath)

                    withContext(Dispatchers.Main) {
                        promise.resolve(result)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        promise.reject(CodedException("ERR_DETECT_LANGUAGE", e.message ?: "Language detection failed", e))
                    }
                }
            }
        }

        // REALTIME TRANSCRIPTION (Placeholder for future)
        AsyncFunction("startRealtimeTranscribe") { contextId: Int, jobId: Int, options: Map<String, Any?>, promise: Promise ->
            promise.reject(CodedException("ERR_NOT_IMPLEMENTED", "Realtime transcription not yet implemented", null))
        }

        AsyncFunction("abortTranscribe") { contextId: Int, jobId: Int, promise: Promise ->
            scope.launch {
                try {
                    contexts[contextId]?.abortTranscribe(jobId)
                    withContext(Dispatchers.Main) {
                        promise.resolve(null)
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        promise.reject(CodedException("ERR_ABORT", e.message ?: "Failed to abort transcription", e))
                    }
                }
            }
        }
    }
}

enum class WhisperError(
    val code: String,
    override val message: String
) : CodedException(code, message) {
    INVALID_PATH("ERR_INVALID_PATH", "Invalid model path"),
    CONTEXT_NOT_FOUND("ERR_CONTEXT_NOT_FOUND", "Context not found"),
    TRANSCRIPTION_FAILED("ERR_TRANSCRIBE", "Transcription failed"),
    AUDIO_RECORDING_FAILED("ERR_AUDIO_RECORDING", "Audio recording failed"),
    NOT_IMPLEMENTED("ERR_NOT_IMPLEMENTED", "Feature not implemented")
}