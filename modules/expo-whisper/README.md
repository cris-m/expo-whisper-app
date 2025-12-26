# expo-whisper

Fast, private speech-to-text for React Native and Expo. Runs entirely on-device using whisper.cpp - no servers, no waiting, no cloud costs.

---

## What's New in v2.0

We cleaned things up. A lot.

**Before**: 25+ exports scattered everywhere. Three layers of abstraction. Type definitions in two places.

**After**: One `Whisper` class that does everything. Two hooks for React. One source of truth for types. Works the same on iOS and Android.

That's it. That's the upgrade.

---

## How It Works

```
Your App
   ↓
Whisper Class (all the logic)
   ↓
Native Layer (Swift on iOS, Kotlin on Android)
   ↓
whisper.cpp (the heavy lifting)
```

That's the entire stack. No middlemen, no extra layers.

---

## Quick Start

### Installation

```bash
npm install expo-whisper
```

### Without React

```typescript
import { Whisper, MODEL_SIZES } from 'expo-whisper';

// Initialize
const whisper = await Whisper.initialize({
  modelPath: '/path/to/ggml-tiny.bin',
  useGpu: true,
});

// Transcribe file
const task = await whisper.transcribeFile('/path/to/audio.wav', {
  language: 'en',
  onProgress: (progress) => console.log(`${progress}%`),
  onSegment: (segment) => console.log(`${segment.start}s: ${segment.text}`),
});

// Access result
console.log(task.result?.text);        // Full transcription
console.log(task.result?.segments);    // Detailed segments with timing

// Check progress anytime
const { progress } = task.getProgress();

// Cancel if needed
await task.cancel();

// Get stats
const stats = whisper.getStats();
console.log(stats); // { active: 0, total: 1, completed: 1, failed: 0 }
```

### React (The Easy Way)

```typescript
import { useWhisper } from 'expo-whisper';

function TranscriptionScreen() {
  const {
    transcribeFile,
    transcribeBuffer,
    progress,
    result,
    segments,
    error,
    isLoading,
    cancel,
  } = useWhisper({
    modelPath: '/path/to/ggml-tiny.bin',
    language: 'en',
  });

  return (
    <View>
      <Button
        onPress={() => transcribeFile('/audio.wav')}
        title="Transcribe File"
      />

      <Text>Progress: {progress}%</Text>

      {isLoading && <ActivityIndicator />}

      {error && <Text style={{color: 'red'}}>{error.message}</Text>}

      {result && (
        <>
          <Text>Text: {result.text}</Text>
          <Text>Duration: {result.duration}s</Text>
        </>
      )}

      {segments.map((seg, i) => (
        <Text key={i}>
          [{seg.start.toFixed(2)}s] {seg.text}
        </Text>
      ))}

      <Button onPress={cancel} title="Cancel" />
    </View>
  );
}
```

### Real-time Transcription

```typescript
// Option 1: With React hook
import { useRealtimeTranscription } from 'expo-whisper';

const {
  isRecording,
  startRecording,
  stopRecording,
  interimText,
  segments,
  metrics,
} = useRealtimeTranscription({
  modelPath: '/path/to/model.bin',
  language: 'en',
});

// Option 2: Direct API
await whisper.startRealtime(300, {
  language: 'en',
  onSegment: (segment) => console.log(segment.text),
  onAudioLevel: (level) => console.log(`Level: ${level}`),
  suppressBlank: true,
  suppressNst: true,
});

// Audio chunks are submitted via React hooks or directly to native layer
// Segments arrive via onSegment callback in real-time

// Stop and get final result
const task = await whisper.stopRealtime();
console.log(task.result?.text); // Accumulated transcription
```

**Important:** Real-time transcription prioritizes responsiveness over accuracy. It processes audio in chunks to give you instant feedback, which means less context compared to batch transcription. For better accuracy, use `recordAndTranscribe()` or record first then transcribe with `transcribeBuffer()`.

### Transcribe Audio Buffer

Everything happens in memory. Load your audio, pass it in, get results.

```typescript
// Audio as Uint8Array (from microphone, file, network, etc)
const audioBuffer = new Uint8Array([...]);

const task = await whisper.transcribeBuffer(audioBuffer, {
  language: 'en',
});

console.log(task.result?.text);
```

Note: `transcribeFile()` is just a convenience method that reads the file into a buffer first, then calls `transcribeBuffer()` internally.

---

## How We Organize It

```
src/
├── Whisper.ts                    # The main class (does everything)
├── NativeModuleWrapper.ts        # Talks to iOS/Android
├── types/
│   ├── whisper.ts               # Type definitions
│   └── common.ts                # Shared types
├── hooks/
│   ├── useWhisper.ts            # File/buffer hook
│   ├── useRealtimeTranscription.ts  # Live transcription hook
│   └── useWhisperMetrics.ts     # Metrics hook
├── utils/
│   ├── AppHelpers.ts            # Model management, permissions
│   ├── Logger.ts                # Logging
│   ├── AudioProcessing.ts       # Audio utilities
│   └── Cache.ts                 # Caching
├── services/ [REMOVED]          # These are now in Whisper.ts
└── operations/ [REMOVED]        # Old architecture
```

**Files we deleted** (all their code went into `Whisper.ts`):
- `src/services/TranscriptionService.ts`
- `src/services/RealtimeTranscriber.ts`
- `src/WhisperLibrary.ts`

---

## Coming From v1.x?

The biggest change is that we merged everything into one `Whisper` class. No more wrappers or services.

### Imports Changed

```typescript
// Old way (v1.x)
import { WhisperLibrary, TranscriptionService } from 'expo-whisper';

// New way (v2.0)
import { Whisper } from 'expo-whisper';
import { useWhisper } from 'expo-whisper';  // If you're using React
```

### Initialization Got Simpler

```typescript
// Old (v1.x)
const whisper = await WhisperLibrary.initialize({ modelPath });
const service = new TranscriptionService(whisper);

// New (v2.0)
const whisper = await Whisper.initialize({ modelPath });
// That's it, just use whisper directly
```

### Getting Results

```typescript
// Old (v1.x)
const result = await service.transcribeFile(filePath, options);
const text = result.result;  // Weird access pattern

// New (v2.0)
const task = await whisper.transcribeFile(filePath, options);
const text = task.result?.text;        // Cleaner
const segments = task.result?.segments;  // Includes word-level timing
```

### Task Tracking is Better Now

```typescript
// v2.0 - Everything returns a task
const task = await whisper.transcribeFile(path, {
  onProgress: (progress) => console.log(`${progress}%`),
  onSegment: (segment) => console.log(segment.text),
});

// Check progress anytime
const { progress, processingTimeMs } = task.getProgress();

// Cancel if you change your mind
await task.cancel();

// Check status
console.log(task.status);      // 'processing', 'complete', 'error', etc.
console.log(task.result?.text);
```

### Realtime Got Cleaner Too

```typescript
// Old (v1.x) - Manually manage sessions
const session = await whisper.createRealtimeTranscriber();
await session.start();
session.feedAudio(chunk);
const result = await session.stop();

// New (v2.0) - Just call start/stop
await whisper.startRealtime(300, {
  language: 'en',
  onSegment: (segment) => console.log(segment.text),
  onAudioLevel: (level) => console.log(`Level: ${level}`),
  suppressBlank: true,
  suppressNst: true,
});

// Audio goes in via React hook or native
// Stop and get everything that was said
const task = await whisper.stopRealtime();
console.log(task.result?.text);
```

---

## API Reference

### Whisper Class

#### Singleton Behavior

The `Whisper` class is a singleton. Calling `initialize()` multiple times returns the same instance:

```typescript
const whisper1 = await Whisper.initialize({ modelPath });
const whisper2 = await Whisper.initialize({ modelPath });
// whisper1 === whisper2 (same instance)
```

To create a fresh instance, call `release()` first:

```typescript
await whisper.release();  // Reset singleton
const newWhisper = await Whisper.initialize({ modelPath });  // New instance
```

#### Static Methods

```typescript
static async initialize(options: WhisperInitOptions): Promise<Whisper>
```

Initialize Whisper context. Returns existing instance if already initialized. Call once before using any transcription methods.

**Options:**
- `modelPath`: string - Path to GGML model file
- `useGpu`: boolean - Enable GPU acceleration (default: true)
- `useCoreMLIos`: boolean - Use CoreML on iOS
- `useFlashAttn`: boolean - Enable Flash Attention
- `useNnapi`: boolean - Use NNAPI on Android
- `useGpuDelegate`: boolean - Use GPU delegate

#### Transcription Methods

**File and Buffer Transcription** return `TranscriptionTask` with:
- `taskId`: Unique task identifier
- `status`: 'queued' | 'processing' | 'complete' | 'error' | 'cancelled'
- `progress`: 0-100
- `result`: `TranscribeResult | undefined`
- `error`: `Error | undefined`
- `cancel()`: Cancel the task
- `getProgress()`: Get detailed progress info

```typescript
async transcribeFile(
  filePath: string,
  options?: TranscribeOptions
): Promise<TranscriptionTask>

async transcribeBuffer(
  audioBuffer: Uint8Array,
  options?: TranscribeOptions
): Promise<TranscriptionTask>
```

#### Recording Methods

**Batch Recording** (record entire audio, then transcribe):

```typescript
async startRecording(): Promise<{ recording: boolean }>

async stopRecording(options?: TranscribeOptions): Promise<TranscriptionTask>

recordAndTranscribe(): {
  stop: (options?: TranscribeOptions) => Promise<TranscribeResult>;
  promise: Promise<TranscribeResult>;
}
```

**Usage Comparison:**

- `startRecording()` + `stopRecording()`: Returns `TranscriptionTask`, better for task tracking and cancellation
- `recordAndTranscribe()`: Returns `{ stop(), promise }`, simpler for quick recordings

```typescript
// Option 1: Full task tracking
await whisper.startRecording(30);
const task = await whisper.stopRecording();
console.log(task.progress);        // Access progress
console.log(task.status);          // Check status
await task.cancel();               // Can cancel

// Option 2: Simple one-liner
const { stop, promise } = whisper.recordAndTranscribe(30);
const result = await promise;      // or: await stop()
console.log(result.text);
```

**TranscribeOptions:**
- `language`: 'en' | 'es' | ... | 'auto' (default: 'auto')
- `temperature`: 0-2 (sampling temperature, default: 0.0)
- `beamSize`: beam search size (default: 5)
- `translate`: enable translation to English (default: false)
- `maxTokens`: maximum tokens to generate (default: 0 = unlimited)
- `suppressBlank`: suppress blank tokens in output (default: true)
- `suppressNst`: suppress non-speech tokens (default: true)
- `onProgress`: (progress: number) => void
- `onSegment`: (segment: Segment) => void

#### Understanding VAD Parameters

**`suppressBlank: boolean`** (default: `true`)

Prevents the model from outputting blank/silent segments.

**What it does:**
- When `true`: Filters out segments that contain only silence or no actual speech content
- When `false`: Includes all segments, even if they're completely blank

**Example:**
```typescript
// WITH suppressBlank: true (recommended)
await whisper.startRealtime(300, {
  suppressBlank: true
});
// Output: Only meaningful speech segments
// Segments: ["Hello", "world", "how are you"]

// WITH suppressBlank: false
await whisper.startRealtime(300, {
  suppressBlank: false
});
// Output: May include blank/silent segments
// Segments: ["", "Hello", "", "world", "how are you"]
```

**When to use:**
- **`true`**: Recommended for most use cases - cleaner output without noise/silence
- **`false`**: If you need to track exact timing including pauses between speech

---

**`suppressNst: boolean`** (default: `true`)

Prevents the model from outputting "non-speech tokens" (NST).

**What it does:**
- NST = Non-Speech Tokens (special tokens whisper.cpp uses internally)
- These are markers for silence, background noise, music, etc.
- When `true`: Filters out these internal tokens from output
- When `false`: Includes these special tokens in transcription

**Example:**
```typescript
// WITH suppressNst: true (recommended)
await whisper.startRealtime(300, {
  suppressNst: true
});
// Output: Clean speech transcription
// Segments: ["Hello world"]

// WITH suppressNst: false
await whisper.startRealtime(300, {
  suppressNst: false
});
// Output: May include NST markers (appears as strange characters/tokens)
// Segments: ["[silence]", "Hello world", "[noise]"]
```

**When to use:**
- **`true`**: Recommended - produces cleaner, more readable output
- **`false`**: Advanced use case - if you need to detect silence/noise separately

---

#### Recommended Configuration

For most applications, use this configuration:

```typescript
await whisper.startRealtime(300, {
  language: 'en',
  suppressBlank: true,   // Filter out silence
  suppressNst: true,     // Filter out non-speech tokens
  onSegment: (segment) => {
    // You'll only receive meaningful speech segments
    console.log(segment.text);  // "Hello", "world", etc.
  }
});
```

**Result**: Clean, professional transcription without noise or artifacts.

---

#### Comparison Table

| Setting | suppressBlank | suppressNst | Result |
|---------|--------------|------------|--------|
| **Production** | true | true | Clean speech only |
| **Debug** | false | false | All segments + NST markers |
| **Permissive** | false | true | All segments, no NST |
| **Aggressive** | true | false | Filtered blanks, with NST |

---

#### Real-world Example

```typescript
const transcript = [];

await whisper.startRealtime(300, {
  suppressBlank: true,   // Don't include empty segments
  suppressNst: true,     // Don't include [silence], [noise] markers
  onSegment: (segment) => {
    transcript.push(segment.text);
    console.log(`User said: "${segment.text}"`);
  }
});

// User speaks: "Hello" [pause] "world" [silence] "how are you"

// Output:
// User said: "Hello"
// User said: "world"
// User said: "how are you"

// Final transcript: ["Hello", "world", "how are you"]
```

Without these flags, you'd get empty segments and special tokens cluttering the output.

---

#### Performance Impact

- **suppressBlank**: Minimal impact - just filters results
- **suppressNst**: Minimal impact - just filters results
- **Recommended**: Always use `true` for both in production

They don't affect processing speed, just clean up the output.

#### Real-time Methods

```typescript
async startRealtime(
  maxDurationSeconds: number = 300,
  callbacksOrOptions?: {
    onSegment?: (segment: Segment) => void;
    onAudioLevel?: (level: number) => void;
  } & Partial<TranscribeOptions>
): Promise<void>

async stopRealtime(
  options?: TranscribeOptions
): Promise<TranscriptionTask>

getRealtimeText(): string
getRealtimeSegments(): Segment[]
isRealtimeActive(): boolean
```

#### Task Management

```typescript
getTask(taskId: string): TranscriptionTask | undefined
getActiveTasks(): TranscriptionTask[]
getStats(): {
  active: number;
  total: number;
  completed: number;
  failed: number;
}
cleanupCompletedTasks(olderThanMs?: number): void
clearCompletedTasks(): void
getLibVersion(): Promise<string>
release(): Promise<void>
```

- `getTask()`: Get a specific task by ID
- `getActiveTasks()`: Get all currently processing/queued tasks
- `getStats()`: Get statistics about all tasks
- `cleanupCompletedTasks()`: Remove completed/failed tasks older than specified time (default: 1 hour)
- `clearCompletedTasks()`: Immediately remove all completed/failed/cancelled tasks
- `getLibVersion()`: Get the version string of the library
- `release()`: Release all resources and cleanup (stops realtime if active, releases native context)

#### Task Lifecycle & Memory Management

Tasks are stored in a map until explicitly cleaned up:

```typescript
// Monitor task accumulation
const { active, total, completed, failed } = whisper.getStats();
console.log(`Active: ${active}, Total: ${total}, Completed: ${completed}`);

// Clean up old tasks (older than 1 hour by default)
whisper.cleanupCompletedTasks();

// Or clean up with custom time threshold (5 minutes)
whisper.cleanupCompletedTasks(5 * 60 * 1000);

// Clear all completed/failed tasks immediately
whisper.clearCompletedTasks();
```

**When to cleanup:**
- Long-running apps with many transcriptions
- Low-memory devices
- Between user sessions
- Before calling `release()`

#### Error Handling

Always check task status after completion:

```typescript
try {
  const task = await whisper.transcribeFile(path);

  if (task.status === 'error') {
    console.error('Transcription failed:', task.error?.message);
  } else if (task.status === 'cancelled') {
    console.log('Transcription was cancelled');
  } else {
    console.log('Result:', task.result?.text);
  }
} catch (error) {
  // Network or initialization errors
  console.error('Error:', error);
}
```

#### Real-time State Queries

Access accumulated results during streaming:

```typescript
await whisper.startRealtime(300, {
  onSegment: (segment) => console.log(segment.text)
});

// Anytime during realtime
if (whisper.isRealtimeActive()) {
  // Segments are delivered via callback, but also available via:
  const text = whisper.getRealtimeText();              // Accumulated text
  const segments = whisper.getRealtimeSegments();      // Accumulated segments

  console.log('Current text:', text);
  console.log('Segments so far:', segments.length);
}

// After stopping
const task = await whisper.stopRealtime();
console.log('Final result:', task.result?.text);
console.log('isRealtimeActive:', whisper.isRealtimeActive());  // false
```

**Note**: `getRealtimeText()` and `getRealtimeSegments()` return empty values if realtime is not active. They are safe to call anytime.

---

## Parameter Flow Through The Stack

Understanding how options flow through the system helps with debugging and extending functionality.

### Example: VAD Parameters (suppressBlank, suppressNst)

**Layer 1: TypeScript API**
```typescript
// User calls startRealtime with options
await whisper.startRealtime(300, {
  language: 'en',
  suppressBlank: true,      // ← Parameter starts here
  suppressNst: true,         // ← Parameter starts here
  onSegment: (seg) => console.log(seg.text)
});
```

**Layer 2: Whisper.ts (TypeScript)**
```typescript
// Parameters extracted and mapped to native names
await ExpoWhisper.startRealtimeTranscribe(this.contextId, jobId, {
  language: callbacksOrOptions?.language || 'auto',
  suppressBlank: callbacksOrOptions?.suppressBlank ?? true,  // ← Passed to native
  suppressNst: callbacksOrOptions?.suppressNst ?? true,      // ← Passed to native
});
```

**Layer 3: NativeModuleWrapper.ts (TypeScript Interface)**
```typescript
// Type definition for native module
startRealtimeTranscribe(
  contextId: number,
  jobId: number,
  options: Record<string, any>  // ← suppressBlank, suppressNst in options
): Promise<void>;
```

**Layer 4: iOS Swift (WhisperContext.swift)**
```swift
// Extract parameters from options dictionary
let suppressBlank = options["suppressBlank"] as? Bool ?? true
let suppressNst = options["suppressNst"] as? Bool ?? true

// Pass to C++ whisper.cpp via FFI
whisper_full_with_state(
  context: contextPtr,
  params: whisper_full_params,
  samples: audioSamples,
  n_samples: audioSamples.count,
  // ... other params ...
  suppress_blank: suppressBlank,  // ← Passed to C++
  suppress_non_speech_tokens: suppressNst  // ← Passed to C++
)
```

**Layer 5: C++ (whisper.cpp library)**
```cpp
// whisper.cpp receives and applies the parameters
struct whisper_full_params {
  bool suppress_blank = true;         // ← Parameter used here
  bool suppress_non_speech_tokens = true;  // ← Parameter used here
};
```

### Key Points

1. **TypeScript → Native**: Options passed as `Record<string, any>` dictionary
2. **Swift/Kotlin**: Extract typed values from dictionary with defaults
3. **C++**: Apply parameters to whisper.cpp inference

4. **Naming Convention**:
   - TypeScript: `camelCase` (suppressBlank, suppressNst)
   - C++: `snake_case` (suppress_blank, suppress_non_speech_tokens)
   - Mapping happens in native layer

5. **Defaults**:
   - TypeScript defaults: `suppressBlank: true`, `suppressNst: true`
   - Applied if user doesn't specify
   - Swift/Kotlin also provide defaults as fallback

### Adding New Parameters

To add a new parameter (e.g., `enableVAD`):

1. **TypeScript (Whisper.ts)**:
   ```typescript
   export interface TranscribeOptions {
     // ... existing options ...
     enableVAD?: boolean;  // NEW
   }

   // Pass to native
   await ExpoWhisper.startRealtimeTranscribe(contextId, jobId, {
     // ... existing options ...
     enableVAD: callbacksOrOptions?.enableVAD ?? true,  // NEW
   });
   ```

2. **Swift (WhisperContext.swift)**:
   ```swift
   let enableVAD = options["enableVAD"] as? Bool ?? true

   // Pass to whisper.cpp
   params.enable_vad = enableVAD
   ```

3. **C++ (whisper.cpp)**:
   ```cpp
   // Used in inference
   if (params.enable_vad) {
     // Apply VAD logic
   }
   ```

### Debugging Parameter Flow

To verify parameters are flowing correctly:

1. **Log in TypeScript** (Whisper.ts):
   ```typescript
   logger.info('[Whisper] Calling startRealtime with options:', {
     suppressBlank: callbacksOrOptions?.suppressBlank,
     suppressNst: callbacksOrOptions?.suppressNst,
   });
   ```

2. **Log in Swift** (WhisperContext.swift):
   ```swift
   NSLog("[WhisperContext] Received options: %@", options as Any)
   NSLog("[WhisperContext] suppressBlank=%d, suppressNst=%d", suppressBlank, suppressNst)
   ```

3. **Check Native Logs**:
   - iOS: Xcode console shows NSLog output
   - Android: Logcat shows println/Log.d output

### Parameter Validation

Parameters are validated at each layer:

1. **TypeScript**: Type system ensures correct types
2. **Native**: Dictionary access with type casting and defaults
3. **C++**: whisper.cpp validates parameter combinations

Example validation:
```swift
// Ensure temperature is in valid range
let temperature = options["temperature"] as? Double ?? 0.0
let validTemp = max(0.0, min(2.0, temperature))  // Clamp to 0-2
```

### useWhisper Hook

Parameters flow through hooks similarly:

```typescript
// User passes options to hook
const { transcribeFile } = useWhisper({
  language: 'en',
  suppressBlank: true  // ← Passed to hook
});

// Hook stores and passes to Whisper.transcribeFile()
const task = await whisper.transcribeFile(path, {
  ...storedOptions,
  suppressBlank: true  // ← Flows through same chain
});
```

### useRealtimeTranscription Hook

Real-time hook also follows the same flow:

```typescript
// Hook receives options
const {} = useRealtimeTranscription({
  language: 'en',
  suppressBlank: true
});

// Passes to Whisper.startRealtime()
await whisper.startRealtime(300, {
  ...mergedOptions,
  suppressBlank: true  // ← Same flow
});
```

---

## Accessing Realtime Data

### Getting Text During Streaming

**Method 1: Via Callback (Recommended)**
```typescript
await whisper.startRealtime(300, {
  onSegment: (segment) => {
    console.log(segment.text);        // Individual segment text
  }
});
```

**Method 2: Query Accumulated Text**
```typescript
await whisper.startRealtime(300, {
  onSegment: (segment) => {
    const allText = whisper.getRealtimeText();  // Full accumulated text
    console.log(allText);
  }
});

// Or anytime while streaming
if (whisper.isRealtimeActive()) {
  const currentText = whisper.getRealtimeText();
}
```

**Method 3: React Hook**
```typescript
const { interimText, segments } = useRealtimeTranscription({
  modelPath: '/path/to/model.bin'
});

return <Text>{interimText}</Text>;  // Updates automatically
```

### Getting Audio Level

**Method 1: Via Callback (Only Way)**
```typescript
await whisper.startRealtime(300, {
  onAudioLevel: (level) => {
    console.log(level);                    // 0.0 - 1.0
    console.log(Math.round(level * 100));  // 0-100%
  }
});
```

**Important**: Audio level is ONLY available via `onAudioLevel` callback. It's not stored anywhere else.

**Method 2: React Hook**
```typescript
const { metrics } = useRealtimeTranscription({
  modelPath: '/path/to/model.bin'
});

// metrics contains audioLevel information
console.log(metrics?.audioLevel);
```

### Getting Segments

**Method 1: Via Callback**
```typescript
const segments = [];

await whisper.startRealtime(300, {
  onSegment: (segment) => {
    segments.push(segment);
    console.log(`[${segment.start}s - ${segment.end}s] ${segment.text}`);
  }
});
```

**Method 2: Query Accumulated Segments**
```typescript
await whisper.startRealtime(300, {
  onSegment: (segment) => {
    const allSegments = whisper.getRealtimeSegments();  // All segments so far
    console.log(allSegments.length);
  }
});

// Or anytime while streaming
if (whisper.isRealtimeActive()) {
  const segments = whisper.getRealtimeSegments();
  console.log(`Current segments: ${segments.length}`);
}
```

**Method 3: React Hook**
```typescript
const { segments } = useRealtimeTranscription({
  modelPath: '/path/to/model.bin'
});

// segments is updated in real-time
return segments.map((seg, i) => (
  <Text key={i}>{seg.text}</Text>
));
```

### Complete Real-time Example

```typescript
import { Whisper } from 'expo-whisper';

const whisper = await Whisper.initialize({ modelPath });

const textParts: string[] = [];
let lastAudioLevel = 0;
const segmentsList: Segment[] = [];

await whisper.startRealtime(300, {
  language: 'en',
  suppressBlank: true,
  suppressNst: true,

  // Receive segments
  onSegment: (segment) => {
    segmentsList.push(segment);
    textParts.push(segment.text);
    console.log(`Segment: "${segment.text}" (${segment.start}s-${segment.end}s)`);
  },

  // Receive audio level
  onAudioLevel: (level) => {
    lastAudioLevel = level;
    const percentage = Math.round(level * 100);
    console.log(`Audio level: ${percentage}%`);
  }
});

// While streaming, query accumulated data
console.log('Current text:', whisper.getRealtimeText());
console.log('Segments so far:', whisper.getRealtimeSegments().length);
console.log('Is streaming:', whisper.isRealtimeActive());

// Stop and get final result
const task = await whisper.stopRealtime();
console.log('Final text:', task.result?.text);
console.log('Total segments:', task.result?.segments?.length);
```

### Data Structure

**Segment Object**
```typescript
interface Segment {
  text: string;           // Transcribed text for this segment
  start: number;          // Start time in milliseconds
  end: number;            // End time in milliseconds
  confidence?: number;    // Confidence score 0-1 (if available)
}
```

**Audio Level**
```typescript
// Range: 0.0 to 1.0
// 0.0 = silence
// 1.0 = maximum loudness
// Calculation: RMS energy normalized

// Convert to percentage
const percentage = Math.round(audioLevel * 100);  // 0-100%

// Common thresholds:
// < 0.1 = silent
// 0.1-0.3 = quiet
// 0.3-0.7 = normal
// > 0.7 = loud
```

**TranscribeResult (Final)**
```typescript
interface TranscribeResult {
  text: string;                    // Full accumulated text
  segments: Segment[];             // All segments with timing
  duration?: number;               // Duration in seconds
  language?: string;               // Detected language
  processingTimeMs?: number;       // Time spent processing
}
```

### Common Patterns

**Track Speaking Duration**
```typescript
const segments = whisper.getRealtimeSegments();
const totalDuration = segments.reduce((sum, seg) =>
  sum + (seg.end - seg.start), 0
);
console.log(`Spoken ${totalDuration}ms of audio`);
```

**Detect Speech Activity**
```typescript
onAudioLevel: (level) => {
  if (level > 0.1) {
    console.log('User is speaking');
  } else {
    console.log('User is silent');
  }
}
```

**Build Timestamped Transcript**
```typescript
onSegment: (segment) => {
  const startSec = (segment.start / 1000).toFixed(2);
  const endSec = (segment.end / 1000).toFixed(2);
  const line = `[${startSec}s] ${segment.text}`;
  console.log(line);
}
```

**Update UI With Both Text and Level**
```typescript
const [text, setText] = useState('');
const [audioLevel, setAudioLevel] = useState(0);

await whisper.startRealtime(300, {
  onSegment: (segment) => {
    setText(prev => prev + (prev ? ' ' : '') + segment.text);
  },
  onAudioLevel: (level) => {
    setAudioLevel(level);
  }
});

return (
  <View>
    <Text>{text}</Text>
    <ProgressBar progress={audioLevel} />
  </View>
);
```

### useWhisper Hook

```typescript
const {
  transcribeFile,
  transcribeBuffer,
  progress,
  result,
  error,
  isLoading,
  segments,
  cancel,
  reset,
} = useWhisper(options);
```

**Options**: `Partial<WhisperInitOptions> & { language?: string }`

**Returns**:
- Methods: `transcribeFile`, `transcribeBuffer`, `cancel`, `reset`
- State: `progress`, `result`, `error`, `isLoading`, `segments`

### useRealtimeTranscription Hook

```typescript
const {
  isConnected,
  isRecording,
  isPaused,
  result,
  error,
  segments,
  interimText,
  metrics,
  startRecording,
  stopRecording,
  pauseRecording,
  resumeRecording,
  submitAudioChunk,
  resetSession,
} = useRealtimeTranscription(options);
```

---

## Advanced Features

### Task Cancellation

```typescript
const task = await whisper.transcribeFile(path);

// Cancel after 5 seconds if still processing
setTimeout(() => task.cancel(), 5000);

// Check if cancelled
if (task.status === 'cancelled') {
  console.log('Task was cancelled');
}
```

### Progress Monitoring

```typescript
const task = await whisper.transcribeFile(path, {
  onProgress: (progress) => {
    console.log(`Processing: ${progress}%`);
  },
});

// Also available via task
const { progress, processingTimeMs, estimatedRemainingMs } = task.getProgress();
```

### Segment Callbacks

```typescript
const segments: Segment[] = [];

await whisper.transcribeFile(path, {
  onSegment: (segment) => {
    console.log(`[${segment.start.toFixed(2)}s - ${segment.end.toFixed(2)}s] ${segment.text}`);
    segments.push(segment);
  },
});
```

### Language Detection

Use `language: 'auto'` to auto-detect:

```typescript
const task = await whisper.transcribeFile(path, {
  language: 'auto',
});

console.log(task.result?.language); // Detected language code
```

### Buffer from Microphone

```typescript
// Record audio chunks
const audioBuffer = new Uint8Array([...audioData]);

const task = await whisper.transcribeBuffer(audioBuffer, {
  language: 'en',
  onSegment: (segment) => console.log(segment.text),
});
```

---

## Type Definitions

### TranscribeResult

```typescript
interface TranscribeResult {
  text: string;                    // Full transcribed text
  segments: Segment[];             // Detailed segments with timing
  duration?: number;               // Audio duration in seconds
  language?: string;               // Detected language (if auto-detect)
  processingTimeMs?: number;       // Time spent processing
  isAborted?: boolean;             // Whether transcription was aborted
  error?: string;                  // Error message if failed
}
```

### Segment

```typescript
interface Segment {
  text: string;                    // Segment text
  start: number;                   // Start time in seconds
  end: number;                     // End time in seconds
  confidence?: number;             // Confidence score (0-1)
}
```

### TranscriptionTask

```typescript
interface TranscriptionTask {
  taskId: string;                  // Unique identifier
  type: 'file' | 'buffer' | 'recording' | 'realtime';
  status: 'queued' | 'processing' | 'complete' | 'error' | 'cancelled';
  progress: number;                // 0-100
  result?: TranscribeResult;       // Result when complete
  error?: Error;                   // Error if failed
  startTime: number;               // Timestamp when started
  endTime?: number;                // Timestamp when ended
  cancel(): Promise<void>;
  getProgress(): {
    progress: number;
    processingTimeMs: number;
    estimatedRemainingMs: number;
  };
}
```

---

## Example Application

See [App.tsx](../../App.tsx) for a complete working example including:
- File transcription with progress
- Buffer transcription
- Real-time transcription with microphone
- Task cancellation
- Error handling

---

## Utilities

### Model Management

```typescript
import {
  downloadModel,
  getModelPath,
  isModelDownloaded,
  deleteModel,
  MODEL_SIZES,
  WHISPER_MODELS,
} from 'expo-whisper';

// Check if model exists
if (await isModelDownloaded('base')) {
  const path = await getModelPath('base');
  const whisper = await Whisper.initialize({ modelPath: path });
}

// Download model
await downloadModel('base', (progress) => {
  console.log(`Downloaded: ${progress}%`);
});

// List available models
console.log(MODEL_SIZES);  // ['tiny', 'base', 'small', ...]
console.log(WHISPER_MODELS); // Full metadata
```

### Permissions

```typescript
import { requestMicrophonePermissions } from 'expo-whisper';

const granted = await requestMicrophonePermissions();
if (granted) {
  // Start recording
}
```

---

## Performance Tips

1. **Use GPU** - Set `useGpu: true` for 5-10× speedup
2. **Model Size** - Smaller models (tiny, base) are 5-10× faster
3. **Language-Specific** - Use `tiny.en` instead of `tiny` for English
4. **Batch Processing** - Process multiple files in parallel using task IDs
5. **Memory** - Clean up completed tasks: `whisper.cleanupCompletedTasks()`

---

## Debugging

Enable logging:

```typescript
import { getLogger } from 'expo-whisper';

const logger = getLogger();
logger.setLevel('debug');
// Now see detailed logs from Whisper operations
```

---

## What's Exported

**Main API** (2 entry points):
- `Whisper` - Core unified class with all transcription methods
- `useWhisper` - React hook for file/buffer transcription

**React Hooks**:
- `useRealtimeTranscription` - Real-time streaming transcription
- `useWhisperMetrics` - Access transcription metrics

**Utilities**:
- `downloadModel(size, onProgress?)` - Download a model
- `isModelDownloaded(size)` - Check if model exists
- `getModelPath(size)` - Get path to downloaded model
- `deleteModel(size)` - Delete a downloaded model
- `cleanAllModels()` - Delete all downloaded models
- `getModelsDirectory()` - Get models storage directory
- `requestMicrophonePermissions()` - Request microphone permission
- `MODEL_SIZES` - Array of available model sizes
- `WHISPER_MODELS` - Full model metadata

**Types**:
- `TranscribeResult` - Transcription output with text, segments, duration, language
- `Segment` - Individual transcribed segment with text, start/end times
- `TranscriptionTask` - Task tracking object with status, progress, cancel, getProgress
- `TranscribeOptions` - Options for transcription (language, temperature, callbacks, VAD params)
- `WhisperInitOptions` - Options for Whisper.initialize()
- `WhisperModelSize` - Model size type union
- `UseWhisperOptions` - Options for useWhisper hook
- `UseWhisperReturn` - Return type of useWhisper hook
- `UseRealtimeTranscriptionOptions` - Options for useRealtimeTranscription hook
- `UseRealtimeTranscriptionReturn` - Return type of useRealtimeTranscription hook
- `RealtimeMetrics` - Real-time transcription metrics

---

## Dependencies

- **React Native** - Core framework
- **expo-modules-core** - Native module support
- **TypeScript 4.5+** - Type safety
- **whisper.cpp** - C++ inference (bundled with native code)

**No** cloud dependencies, no external ML services required.

---

## License

MIT

## Support

- [Whisper.cpp Docs](https://github.com/ggerganov/whisper.cpp)
- [Expo Modules](https://docs.expo.dev/modules/overview/)
- GitHub Discussions

---

**v2.0 Complete Rewrite** - Simplified, unified, production-ready.
