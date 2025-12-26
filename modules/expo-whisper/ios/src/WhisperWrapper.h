//
//  WhisperWrapper.h
//  Objective-C wrapper for whisper.cpp
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^WhisperProgressCallback)(int progress);
typedef void (^WhisperNewSegmentCallback)(NSString *text, int64_t startTime, int64_t endTime);

@interface WhisperWrapper : NSObject

- (nullable instancetype)initWithModelPath:(NSString *)modelPath
                                    useGpu:(BOOL)useGpu
                                 useCoreML:(BOOL)useCoreML
                              useFlashAttn:(BOOL)useFlashAttn;

- (void)freeContext;
- (BOOL)isContextReady;

- (nullable NSDictionary *)transcribeAudioSamples:(NSData *)audioSamples
                                       sampleRate:(int)sampleRate
                                         language:(nullable NSString *)language
                                        translate:(BOOL)translate
                                        maxTokens:(int)maxTokens
                                    suppressBlank:(BOOL)suppressBlank
                                      suppressNst:(BOOL)suppressNst
                                  progressCallback:(nullable WhisperProgressCallback)progressCallback
                               newSegmentCallback:(nullable WhisperNewSegmentCallback)newSegmentCallback
                                            error:(NSError **)error;

- (NSArray<NSDictionary *> *)getAllSegments;
- (NSString *)getFullText;

/// Detect language from audio samples using whisper_lang_auto_detect_with_state
/// Uses the whisper.cpp API to detect language from PCM audio data
- (nullable NSDictionary *)detectLanguageWithState:(NSData *)audioSamples
                                        sampleRate:(int32_t)sampleRate
                                          nThreads:(int)nThreads
                                             error:(NSError **)error;

/// Start chunked real-time transcription using whisper_full_with_state
/// Processes audio in chunks with state reuse for continuity
- (void)startChunkedRealtimeTranscribeWithState:(int32_t)chunkDurationMs
                                  samplesPerChunk:(int32_t)samplesPerChunk
                                        language:(nullable NSString *)language
                                       translate:(BOOL)translate
                                       maxTokens:(int32_t)maxTokens
                                         useVad:(BOOL)useVad
                                   audioContext:(int32_t)audioContext
                                   singleSegment:(BOOL)singleSegment
                                       noContext:(BOOL)noContext
                                     onChunkComplete:(void (^)(NSDictionary *))onChunkComplete
                                          error:(NSError **)error;

@end

NS_ASSUME_NONNULL_END
