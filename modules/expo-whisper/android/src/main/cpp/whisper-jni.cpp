#include "whisper.h"
#include <android/log.h>
#include <jni.h>
#include <sstream>
#include <string>
#include <vector>

#define TAG "WhisperJNI"
#define LOGD(...) __android_log_print(ANDROID_LOG_DEBUG, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

extern "C" {

JNIEXPORT jlong JNICALL Java_expo_modules_whisper_WhisperContext_initContext(
    JNIEnv *env, jclass clazz, jstring modelPathStr) {
  const char *modelPath = env->GetStringUTFChars(modelPathStr, nullptr);
  LOGD("Initializing context with model: %s", modelPath);

  struct whisper_context_params params = whisper_context_default_params();
  struct whisper_context *ctx =
      whisper_init_from_file_with_params(modelPath, params);

  env->ReleaseStringUTFChars(modelPathStr, modelPath);

  if (ctx == nullptr) {
    LOGE("Failed to initialize whisper context");
    return 0;
  }

  return (jlong)ctx;
}

JNIEXPORT void JNICALL Java_expo_modules_whisper_WhisperContext_freeContext(
    JNIEnv *env, jclass clazz, jlong contextPtr) {
  struct whisper_context *ctx = (struct whisper_context *)contextPtr;
  if (ctx) {
    whisper_free(ctx);
    LOGD("Context freed");
  }
}

JNIEXPORT jstring JNICALL
Java_expo_modules_whisper_WhisperContext_fullTranscribe(JNIEnv *env,
                                                        jclass clazz,
                                                        jlong contextPtr,
                                                        jbyteArray audioData,
                                                        jstring languageStr,
                                                        jboolean translate,
                                                        jint maxTokens,
                                                        jboolean suppressBlank,
                                                        jboolean suppressNst) {
  struct whisper_context *ctx = (struct whisper_context *)contextPtr;
  if (!ctx)
    return env->NewStringUTF("{}");

  const char *language = env->GetStringUTFChars(languageStr, nullptr);
  LOGD("Transcribing with language: %s, translate: %d, suppressBlank: %d, suppressNst: %d",
       language, translate, suppressBlank, suppressNst);

  jsize len = env->GetArrayLength(audioData);
  jbyte *bytes = env->GetByteArrayElements(audioData, nullptr);

  // Quick WAV parsing (skip 44 bytes header)
  if (len < 44) {
    env->ReleaseByteArrayElements(audioData, bytes, 0);
    env->ReleaseStringUTFChars(languageStr, language);
    return env->NewStringUTF("{\"error\":\"Invalid WAV\"}");
  }

  int pcmLen = (len - 44) / 2;
  std::vector<float> samples(pcmLen);
  const int16_t *pcm16 = (const int16_t *)(bytes + 44);

  for (int i = 0; i < pcmLen; i++) {
    samples[i] = (float)pcm16[i] / 32768.0f;
  }

  env->ReleaseByteArrayElements(audioData, bytes, 0);

  whisper_full_params params =
      whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
  params.print_progress = false;
  params.print_realtime = false;
  params.suppress_blank = suppressBlank;
  params.suppress_nst = suppressNst;

  if (maxTokens > 0) {
    params.max_tokens = maxTokens;
  }

  if (translate) {
    params.translate = true;
  }

  if (strcmp(language, "auto") != 0) {
    params.language = whisper_lang_id(language);
  }

  if (whisper_full(ctx, params, samples.data(), samples.size()) != 0) {
    env->ReleaseStringUTFChars(languageStr, language);
    return env->NewStringUTF("{\"error\":\"Transformation failed\"}");
  }

  env->ReleaseStringUTFChars(languageStr, language);

  std::stringstream json;
  json << "{";
  json << "\"text\": \"";

  int n_segments = whisper_full_n_segments(ctx);
  for (int i = 0; i < n_segments; ++i) {
    const char *text = whisper_full_get_segment_text(ctx, i);
    json << text;
  }
  json << "\", \"segments\": [";

  for (int i = 0; i < n_segments; ++i) {
    const char *text = whisper_full_get_segment_text(ctx, i);
    int64_t t0 = whisper_full_get_segment_t0(ctx, i);
    int64_t t1 = whisper_full_get_segment_t1(ctx, i);

    json << (i > 0 ? "," : "") << "{";
    json << "\"text\": \"" << text << "\",";
    json << "\"t0\": " << t0 << ",";
    json << "\"t1\": " << t1;
    json << "}";
  }

  json << "]}";

  return env->NewStringUTF(json.str().c_str());
}
}
