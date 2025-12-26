//
//  WhisperWrapper.mm
//  Objective-C++ implementation of WhisperWrapper
//

#import "WhisperWrapper.h"
#include "whisper.h"
#include <vector>
#include <string>

@interface WhisperWrapper ()
{
    struct whisper_context *_context;
    std::vector<std::string> _segments;
    std::vector<int64_t> _segmentStartTimes;
    std::vector<int64_t> _segmentEndTimes;
}
@end

@implementation WhisperWrapper

- (nullable instancetype)initWithModelPath:(NSString *)modelPath
                                    useGpu:(BOOL)useGpu
                                useCoreML:(BOOL)useCoreML
                             useFlashAttn:(BOOL)useFlashAttn {
    self = [super init];
    if (self) {
        NSLog(@"[WhisperWrapper] Initializing with model: %@, GPU: %d, CoreML: %d, FlashAttn: %d",
              modelPath, useGpu, useCoreML, useFlashAttn);

        NSFileManager *fileManager = [NSFileManager defaultManager];
        if (![fileManager fileExistsAtPath:modelPath]) {
            NSLog(@"[WhisperWrapper] CRITICAL: Model file does not exist at path: %@", modelPath);
            return nil;
        }

        NSDictionary *attributes = [fileManager attributesOfItemAtPath:modelPath error:nil];
        NSNumber *fileSizeNum = [attributes objectForKey:NSFileSize];
        if (!fileSizeNum || [fileSizeNum longLongValue] < 1000000) {
            NSLog(@"[WhisperWrapper] CRITICAL: Model file is too small or corrupted. Size: %lld bytes", [fileSizeNum longLongValue]);
            return nil;
        }
        NSLog(@"[WhisperWrapper] Model file validated. Size: %lld bytes", [fileSizeNum longLongValue]);

        struct whisper_context_params params = whisper_context_default_params();
        params.use_gpu = useGpu;
        params.flash_attn = useFlashAttn;

        NSLog(@"[WhisperWrapper] Calling whisper_init_from_file_with_params with path: %s", [modelPath UTF8String]);

        @try {
            _context = whisper_init_from_file_with_params([modelPath UTF8String], params);
        } @catch (NSException *exception) {
            NSLog(@"[WhisperWrapper] EXCEPTION during whisper_init_from_file_with_params: %@, reason: %@", exception.name, exception.reason);
            return nil;
        }

        if (!_context) {
            NSLog(@"[WhisperWrapper] CRITICAL: Failed to initialize whisper context. Function returned NULL.");
            return nil;
        }

        NSLog(@"[WhisperWrapper] SUCCESS: Whisper context initialized successfully");
    }
    return self;
}

- (void)dealloc {
    [self freeContext];
}

- (void)freeContext {
    if (_context) {
        whisper_free(_context);
        _context = nullptr;
    }
    _segments.clear();
    _segmentStartTimes.clear();
    _segmentEndTimes.clear();
}

- (BOOL)isContextReady {
    return _context != nullptr;
}

- (nullable NSDictionary *)transcribeAudioSamples:(NSData *)audioSamples
                                       sampleRate:(int)sampleRate
                                         language:(nullable NSString *)language
                                        translate:(BOOL)translate
                                        maxTokens:(int)maxTokens
                                   suppressBlank:(BOOL)suppressBlank
                                       suppressNst:(BOOL)suppressNst
                                  progressCallback:(nullable WhisperProgressCallback)progressCallback
                               newSegmentCallback:(nullable WhisperNewSegmentCallback)newSegmentCallback
                                            error:(NSError **)error {
    if (!_context) {
        if (error) {
            *error = [NSError errorWithDomain:@"WhisperWrapper"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey: @"Context not initialized"}];
        }
        return nil;
    }

    _segments.clear();
    _segmentStartTimes.clear();
    _segmentEndTimes.clear();

    const float *samples = (const float *)[audioSamples bytes];
    int nSamples = (int)([audioSamples length] / sizeof(float));

    struct whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);

    params.print_realtime = false;
    params.print_progress = false;
    params.print_timestamps = false;
    params.print_special = false;
    params.translate = translate;
    params.n_threads = 4;
    params.single_segment = false;
    params.token_timestamps = true;
    params.suppress_blank = suppressBlank;
    params.suppress_nst = suppressNst;

    if (maxTokens > 0) {
        params.max_tokens = maxTokens;
    }

    if (language) {
        params.language = [language UTF8String];
    } else {
        params.language = "auto";
    }

    int result = whisper_full(_context, params, samples, nSamples);

    if (result != 0) {
        if (error) {
            *error = [NSError errorWithDomain:@"WhisperWrapper"
                                         code:result
                                     userInfo:@{NSLocalizedDescriptionKey: @"Transcription failed"}];
        }
        return nil;
    }

    int nSegments = whisper_full_n_segments(_context);
    NSMutableArray *segmentsArray = [NSMutableArray arrayWithCapacity:nSegments];
    NSMutableString *fullText = [NSMutableString string];

    for (int i = 0; i < nSegments; i++) {
        const char *text = whisper_full_get_segment_text(_context, i);
        int64_t t0 = whisper_full_get_segment_t0(_context, i);
        int64_t t1 = whisper_full_get_segment_t1(_context, i);

        NSString *segmentText = [NSString stringWithUTF8String:text];

        _segments.push_back(std::string(text));
        _segmentStartTimes.push_back(t0);
        _segmentEndTimes.push_back(t1);

        [fullText appendString:segmentText];

        NSDictionary *segment = @{
            @"text": segmentText,
            @"t0": @(t0),
            @"t1": @(t1)
        };
        [segmentsArray addObject:segment];

        if (newSegmentCallback) {
            newSegmentCallback(segmentText, t0, t1);
        }
    }

    return @{
        @"result": fullText,
        @"segments": segmentsArray
    };
}

- (NSArray<NSDictionary *> *)getAllSegments {
    NSMutableArray *result = [NSMutableArray arrayWithCapacity:_segments.size()];

    for (size_t i = 0; i < _segments.size(); i++) {
        NSDictionary *segment = @{
            @"text": [NSString stringWithUTF8String:_segments[i].c_str()],
            @"t0": @(_segmentStartTimes[i]),
            @"t1": @(_segmentEndTimes[i])
        };
        [result addObject:segment];
    }

    return result;
}

- (NSString *)getFullText {
    NSMutableString *result = [NSMutableString string];
    for (const auto &segment : _segments) {
        [result appendString:[NSString stringWithUTF8String:segment.c_str()]];
    }
    return result;
}

- (nullable NSDictionary *)detectLanguageWithState:(NSData *)audioSamples
                                        sampleRate:(int32_t)sampleRate
                                          nThreads:(int)nThreads
                                             error:(NSError **)error {
    if (!_context) {
        if (error) {
            *error = [NSError errorWithDomain:@"WhisperWrapper"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey: @"Context not initialized"}];
        }
        return nil;
    }

    const float *samples = (const float *)[audioSamples bytes];
    int nSamples = (int)([audioSamples length] / sizeof(float));

    struct whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.print_realtime = false;
    params.print_progress = false;
    params.print_timestamps = false;
    params.print_special = false;
    params.language = "auto";
    params.n_threads = nThreads;
    params.single_segment = true;

    int result = whisper_full(_context, params, samples, nSamples);
    if (result != 0) {
        if (error) {
            *error = [NSError errorWithDomain:@"WhisperWrapper"
                                         code:result
                                     userInfo:@{NSLocalizedDescriptionKey: @"Language detection failed"}];
        }
        return nil;
    }

    return @{
        @"language": @"unknown",
        @"confidence": @(0.5f),
        @"languageName": @"Auto-detected"
    };
}

- (void)startChunkedRealtimeTranscribeWithState:(int32_t)chunkDurationMs
                                  samplesPerChunk:(int32_t)samplesPerChunk
                                        language:(nullable NSString *)language
                                       translate:(BOOL)translate
                                       maxTokens:(int32_t)maxTokens
                                   suppressBlank:(BOOL)suppressBlank
                                       suppressNst:(BOOL)suppressNst
                                   audioContext:(int32_t)audioContext
                                   singleSegment:(BOOL)singleSegment
                                       noContext:(BOOL)noContext
                                     onChunkComplete:(void (^)(NSDictionary *))onChunkComplete
                                          error:(NSError **)error {
    if (!_context) {
        if (error) {
            *error = [NSError errorWithDomain:@"WhisperWrapper"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey: @"Context not initialized"}];
        }
        if (onChunkComplete) {
            onChunkComplete(@{@"error": @"Context not initialized"});
        }
        return;
    }

    struct whisper_state *state = whisper_init_state(_context);
    if (!state) {
        if (error) {
            *error = [NSError errorWithDomain:@"WhisperWrapper"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey: @"Failed to initialize whisper state"}];
        }
        if (onChunkComplete) {
            onChunkComplete(@{@"error": @"Failed to initialize state"});
        }
        return;
    }

    struct whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);

    params.print_realtime = false;
    params.print_progress = false;
    params.print_timestamps = false;
    params.print_special = false;
    params.translate = translate;
    params.n_threads = 4;
    params.single_segment = singleSegment;
    params.no_context = noContext;
    params.audio_ctx = audioContext;
    params.token_timestamps = true;
    params.suppress_blank = suppressBlank;
    params.suppress_nst = suppressNst;

    if (maxTokens > 0) {
        params.max_tokens = maxTokens;
    }

    if (language) {
        params.language = [language UTF8String];
    } else {
        params.language = "auto";
    }

    NSMutableArray *accumulatedSegments = [NSMutableArray array];
    NSMutableString *accumulatedText = [NSMutableString string];

    @try {
        int nSegments = whisper_full_n_segments(_context);
        for (int i = 0; i < nSegments; i++) {
            const char *text = whisper_full_get_segment_text(_context, i);
            int64_t t0 = whisper_full_get_segment_t0(_context, i);
            int64_t t1 = whisper_full_get_segment_t1(_context, i);

            NSString *segmentText = [NSString stringWithUTF8String:text];
            [accumulatedText appendString:segmentText];

            NSDictionary *segment = @{
                @"text": segmentText,
                @"t0": @(t0),
                @"t1": @(t1)
            };
            [accumulatedSegments addObject:segment];
        }

        if (onChunkComplete) {
            onChunkComplete(@{
                @"accumulatedTranscript": accumulatedText,
                @"allSegments": accumulatedSegments,
                @"isCapturing": @YES
            });
        }
    } @catch (NSException *exception) {
        if (error) {
            *error = [NSError errorWithDomain:@"WhisperWrapper"
                                         code:-1
                                     userInfo:@{NSLocalizedDescriptionKey: exception.reason ?: @"Chunked transcription failed"}];
        }
        if (onChunkComplete) {
            onChunkComplete(@{@"error": exception.reason ?: @"Chunked transcription failed"});
        }
    }
}

@end
