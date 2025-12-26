import ExpoModulesCore
import AVFoundation

public class ExpoWhisperModule: Module {
    private var contexts: [Int: WhisperContext] = [:]
    private var nextContextId = 1

    public func definition() -> ModuleDefinition {
        Name("ExpoWhisper")

        Events(
            "onTranscribeProgress",
            "onTranscribeNewSegments",
            "onRealtimeTranscribe",
            "onRealtimeTranscribeEnd",
            "onChunkedRealtimeChunkComplete"
        )

        AsyncFunction("getLibVersion") { () -> String in
            return WhisperContext.getLibVersion()
        }

        AsyncFunction("requestMicrophonePermission") { (promise: Promise) in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                promise.resolve(granted)
            }
        }

        AsyncFunction("getMicrophonePermissionStatus") { () -> Bool in
            let status = AVAudioSession.sharedInstance().recordPermission
            return status == .granted
        }

        AsyncFunction("initContext") { (options: [String: Any]) -> [String: Any] in
            guard let filePath = options["filePath"] as? String else {
                throw WhisperError.invalidModelPath
            }

            let useGpu = options["useGpu"] as? Bool ?? false
            #if targetEnvironment(simulator)
            let useCoreML = options["useCoreMLIos"] as? Bool ?? false
            #else
            let useCoreML = options["useCoreMLIos"] as? Bool ?? true
            #endif
            let useFlashAttn = options["useFlashAttn"] as? Bool ?? false

            let contextId = self.nextContextId
            self.nextContextId += 1

            let context = try WhisperContext(
                modelPath: filePath,
                contextId: contextId,
                useGpu: useGpu,
                useCoreML: useCoreML,
                useFlashAttn: useFlashAttn
            )

            self.contexts[contextId] = context

            return [
                "contextId": contextId,
                "gpu": context.isGpuEnabled,
                "reasonNoGPU": context.reasonNoGpu
            ]
        }

        AsyncFunction("releaseContext") { (contextId: Int) in
            if let context = self.contexts[contextId] {
                context.release()
                self.contexts.removeValue(forKey: contextId)
            }
        }

        AsyncFunction("releaseAllContexts") { () in
            for (_, context) in self.contexts {
                context.release()
            }
            self.contexts.removeAll()
        }

        AsyncFunction("transcribeFile") { (contextId: Int, jobId: Int, filePath: String, options: [String: Any]) -> [String: Any] in
            guard let context = self.contexts[contextId] else {
                throw WhisperError.contextNotFound
            }

            let onProgress = options["onProgress"] as? Bool ?? false
            let onNewSegments = options["onNewSegments"] as? Bool ?? false

            let progressCallback: ((Int) -> Void)? = onProgress ? { progress in
                self.sendEvent("onTranscribeProgress", [
                    "contextId": contextId,
                    "jobId": jobId,
                    "progress": progress
                ])
            } : nil

            let newSegmentsCallback: (([String: Any]) -> Void)? = onNewSegments ? { result in
                self.sendEvent("onTranscribeNewSegments", [
                    "contextId": contextId,
                    "jobId": jobId,
                    "result": result
                ])
            } : nil

            var enhancedOptions = options
            enhancedOptions["language"] = options["language"] as? String ?? "auto"
            enhancedOptions["translate"] = options["translate"] as? Bool ?? false
            enhancedOptions["maxTokens"] = options["maxTokens"] as? Int ?? 0
            enhancedOptions["temperature"] = options["temperature"] as? Double ?? 0.0
            enhancedOptions["initialPrompt"] = options["initialPrompt"] as? String
            enhancedOptions["tokenTimestamps"] = options["tokenTimestamps"] as? Bool ?? false
            enhancedOptions["suppressBlank"] = options["suppressBlank"] as? Bool ?? true
            enhancedOptions["suppressNst"] = options["suppressNst"] as? Bool ?? true
            enhancedOptions["samplingStrategy"] = options["samplingStrategy"] as? String ?? "greedy"
            enhancedOptions["beamSearchBeamSize"] = options["beamSearchBeamSize"] as? Int ?? 5

            do {
                let result = try await context.transcribe(
                    audioPath: filePath,
                    jobId: jobId,
                    options: enhancedOptions,
                    onProgress: progressCallback,
                    onNewSegments: newSegmentsCallback
                )

                return result
            } catch {
                throw WhisperError.transcriptionFailed("File transcription failed: \(error.localizedDescription)")
            }
        }

        AsyncFunction("transcribeBuffer") { (contextId: Int, jobId: Int, audioData: String, options: [String: Any]) -> [String: Any] in
            guard let context = self.contexts[contextId] else {
                throw WhisperError.contextNotFound
            }

            guard let data = Data(base64Encoded: audioData) else {
                throw WhisperError.transcriptionFailed("Invalid base64 audio data")
            }

            let onProgress = options["onProgress"] as? Bool ?? false
            let onNewSegments = options["onNewSegments"] as? Bool ?? false

            let progressCallback: ((Int) -> Void)? = onProgress ? { progress in
                self.sendEvent("onTranscribeProgress", [
                    "contextId": contextId,
                    "jobId": jobId,
                    "progress": progress
                ])
            } : nil

            let newSegmentsCallback: (([String: Any]) -> Void)? = onNewSegments ? { result in
                self.sendEvent("onTranscribeNewSegments", [
                    "contextId": contextId,
                    "jobId": jobId,
                    "result": result
                ])
            } : nil

            var enhancedOptions = options
            enhancedOptions["language"] = options["language"] as? String ?? "auto"
            enhancedOptions["translate"] = options["translate"] as? Bool ?? false
            enhancedOptions["maxTokens"] = options["maxTokens"] as? Int ?? 0
            enhancedOptions["temperature"] = options["temperature"] as? Double ?? 0.0
            enhancedOptions["initialPrompt"] = options["initialPrompt"] as? String
            enhancedOptions["tokenTimestamps"] = options["tokenTimestamps"] as? Bool ?? false
            enhancedOptions["suppressBlank"] = options["suppressBlank"] as? Bool ?? true
            enhancedOptions["suppressNst"] = options["suppressNst"] as? Bool ?? true
            enhancedOptions["samplingStrategy"] = options["samplingStrategy"] as? String ?? "greedy"
            enhancedOptions["beamSearchBeamSize"] = options["beamSearchBeamSize"] as? Int ?? 5

            do {
                let result = try await context.transcribeData(
                    audioData: data,
                    jobId: jobId,
                    options: enhancedOptions,
                    onProgress: progressCallback,
                    onNewSegments: newSegmentsCallback
                )

                return result
            } catch {
                throw WhisperError.transcriptionFailed("Buffer transcription failed: \(error.localizedDescription)")
            }
        }

        AsyncFunction("startBufferRecording") { (contextId: Int) -> String in
            guard let context = self.contexts[contextId] else {
                throw WhisperError.contextNotFound
            }

            do {
                let recordingId = try context.startBufferRecording()
                return recordingId
            } catch {
                throw WhisperError.audioRecordingFailed("Failed to start buffer recording: \(error.localizedDescription)")
            }
        }

        AsyncFunction("stopBufferRecording") { (contextId: Int) -> String in
            guard let context = self.contexts[contextId] else {
                throw WhisperError.contextNotFound
            }

            do {
                let wavData = try context.stopBufferRecording()
                let base64String = wavData.base64EncodedString()
                return base64String
            } catch {
                throw WhisperError.audioRecordingFailed("Failed to stop buffer recording: \(error.localizedDescription)")
            }
        }

        AsyncFunction("getBufferRecordingAudioLevel") { (contextId: Int) -> Double in
            guard let context = self.contexts[contextId] else {
                throw WhisperError.contextNotFound
            }

            return context.getBufferRecordingAudioLevel()
        }

        AsyncFunction("transcribeBufferRecording") { (contextId: Int, jobId: Int, options: [String: Any]) -> [String: Any] in
            guard let context = self.contexts[contextId] else {
                throw WhisperError.contextNotFound
            }

            let onProgress = options["onProgress"] as? Bool ?? false
            let onNewSegments = options["onNewSegments"] as? Bool ?? false

            let progressCallback: ((Int) -> Void)? = onProgress ? { progress in
                self.sendEvent("onTranscribeProgress", [
                    "contextId": contextId,
                    "jobId": jobId,
                    "progress": progress
                ])
            } : nil

            let newSegmentsCallback: (([String: Any]) -> Void)? = onNewSegments ? { result in
                self.sendEvent("onTranscribeNewSegments", [
                    "contextId": contextId,
                    "jobId": jobId,
                    "result": result
                ])
            } : nil

            do {
                let result = try await context.transcribeBufferRecording(
                    jobId: jobId,
                    options: options,
                    onProgress: progressCallback,
                    onNewSegments: newSegmentsCallback
                )
                return result
            } catch {
                throw WhisperError.transcriptionFailed("Buffer recording transcription failed: \(error.localizedDescription)")
            }
        }

        AsyncFunction("startRealtimeTranscribe") { (contextId: Int, jobId: Int, options: [String: Any]) in
            guard let context = self.contexts[contextId] else {
                throw WhisperError.contextNotFound
            }

            try await context.startRealtimeTranscribe(
                jobId: jobId,
                options: options,
                onTranscribe: { payload in
                    self.sendEvent("onRealtimeTranscribe", [
                        "contextId": contextId,
                        "jobId": jobId,
                        "payload": payload
                    ])
                },
                onEnd: { payload in
                    self.sendEvent("onRealtimeTranscribeEnd", [
                        "contextId": contextId,
                        "jobId": jobId,
                        "payload": payload
                    ])
                }
            )
        }

        AsyncFunction("abortTranscribe") { (contextId: Int, jobId: Int) in
            if let context = self.contexts[contextId] {
                context.abortTranscribe(jobId: jobId)
            }
        }

        AsyncFunction("detectLanguage") { (contextId: Int, filePath: String) -> [String: Any] in
            guard let context = self.contexts[contextId] else {
                throw WhisperError.contextNotFound
            }

            do {
                let result = try await context.detectLanguage(audioPath: filePath)
                return result
            } catch {
                throw WhisperError.transcriptionFailed("Language detection failed: \(error.localizedDescription)")
            }
        }
    }
}

enum WhisperError: Error {
    case invalidModelPath
    case contextNotFound
    case transcriptionFailed(String)
    case audioRecordingFailed(String)
}