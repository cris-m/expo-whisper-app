package expo.modules.whisper

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import android.util.Base64
import org.json.JSONObject

class ExpoWhisperModule : Module() {
    private val contexts = mutableMapOf<Int, WhisperContext>()
    private var nextContextId = 1
    private val audioBufferManager = AudioBufferManager()

    override fun definition() = ModuleDefinition {
        Name("ExpoWhisper")

        Events(
            "onTranscribeProgress",
            "onTranscribeNewSegments",
            "onRealtimeTranscribe",
            "onRealtimeTranscribeEnd"
        )

        AsyncFunction("getLibVersion") {
            "1.0.0"
        }

        AsyncFunction("requestMicrophonePermission") { promise: Promise ->
            val context = appContext.reactContext ?: return@AsyncFunction promise.resolve(false)
            val result = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
            promise.resolve(result == PackageManager.PERMISSION_GRANTED)
        }

        AsyncFunction("initContext") { options: Map<String, Any> ->
            val filePath = options["filePath"] as? String ?: throw Exception("filePath is required")
            
            val contextId = nextContextId++
            val context = WhisperContext(contextId, filePath)
            contexts[contextId] = context

            mapOf(
                "contextId" to contextId,
                "gpu" to false,
                "reasonNoGpu" to "Not implemented on Android yet"
            )
        }

        AsyncFunction("releaseContext") { contextId: Int ->
            val context = contexts.remove(contextId)
            context?.release()
        }

        AsyncFunction("startBufferRecording") { contextId: Int ->
            contexts[contextId] ?: throw Exception("Context not found")
            audioBufferManager.startRecording()
        }

        AsyncFunction("stopBufferRecording") { contextId: Int ->
            audioBufferManager.stopRecording() ?: throw Exception("No recording available")
        }

        AsyncFunction("transcribeBuffer") { contextId: Int, jobId: Int, audioData: String, options: Map<String, Any> ->
            val context = contexts[contextId] ?: throw Exception("Context not found")
            val bytes = Base64.decode(audioData, Base64.DEFAULT)

            val suppressBlank = options["suppressBlank"] as? Boolean ?? true
            val suppressNst = options["suppressNst"] as? Boolean ?? true
            val language = options["language"] as? String ?: "auto"
            val translate = options["translate"] as? Boolean ?: false
            val maxTokens = options["maxTokens"] as? Int ?: 0

            val resultJson = context.transcribeBuffer(
                bytes,
                language = language,
                translate = translate,
                maxTokens = maxTokens,
                suppressBlank = suppressBlank,
                suppressNst = suppressNst
            )

            val jsonObj = JSONObject(resultJson)
            val segments = jsonObj.getJSONArray("segments")
            val segmentList = mutableListOf<Map<String, Any>>()
            
            for (i in 0 until segments.length()) {
                val seg = segments.getJSONObject(i)
                segmentList.add(mapOf(
                    "text" to seg.getString("text"),
                    "t0" to seg.getLong("t0"),
                    "t1" to seg.getLong("t1")
                ))
            }

            mapOf(
                "text" to jsonObj.optString("text", ""),
                "segments" to segmentList,
                "language" to "auto"
            )
        }

        AsyncFunction("startRealtimeTranscribe") { contextId: Int, jobId: Int, options: Map<String, Any> ->
            contexts[contextId] ?: throw Exception("Context not found")

            sendEvent("onRealtimeTranscribe", mapOf(
                "contextId" to contextId,
                "jobId" to jobId,
                "payload" to mapOf(
                    "text" to "",
                    "segments" to emptyList<Map<String, Any>>(),
                    "audioLevel" to 0.0,
                    "isCapturing" to true
                )
            ))
        }

        AsyncFunction("stopRealtimeTranscribe") { contextId: Int, jobId: Int, options: Map<String, Any> ->
            contexts[contextId] ?: throw Exception("Context not found")

            sendEvent("onRealtimeTranscribeEnd", mapOf(
                "contextId" to contextId,
                "jobId" to jobId,
                "payload" to mapOf(
                    "text" to "",
                    "segments" to emptyList<Map<String, Any>>(),
                    "isCapturing" to false
                )
            ))
        }

        AsyncFunction("abortTranscribe") { contextId: Int, jobId: Int ->
        }
    }
}
