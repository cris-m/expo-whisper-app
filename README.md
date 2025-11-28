# expo-whisper

On-device speech-to-text for React Native using [whisper.cpp](https://github.com/ggerganov/whisper.cpp).

## Features

- On-device transcription (no server needed)
- Real-time transcription from microphone
- Transcribe audio files
- 12 models: tiny (75MB) to large-v3 (3.1GB)
- Automatic model download and caching from HuggingFace
- iOS and Android
- GPU acceleration
- TypeScript

## Installation

### Local Module (Current Setup)

This is a local Expo module included in the whisperapp project. It's configured in `package.json`:

```json
"expo-whisper": "file:./modules/expo-whisper"
```

Simply import from your app:

```typescript
import { useWhisper, downloadModel, getModelPath } from 'expo-whisper';
```

### Dependencies

```bash
npm install expo-file-system react-native-quick-base64
```

`react-native-quick-base64` is needed for audio buffer encoding/decoding. It's native, so it's much faster.

### iOS Configuration

Add microphone permissions to `app.json`:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSMicrophoneUsageDescription": "Microphone access is required for speech-to-text transcription"
      }
    }
  }
}
```

### Android Configuration

Permissions are handled automatically.

## Quick Start

### 1. Download & Initialize Model

Models download automatically from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp) and get cached locally.

```typescript
import { useWhisper, downloadModel, getModelPath, isModelDownloaded } from 'expo-whisper';

export default function App() {
  const whisper = useWhisper();

  const initialize = async () => {
    // Check if model is already downloaded
    const exists = await isModelDownloaded('tiny');

    if (!exists) {
      // Automatically downloads from HuggingFace (~75MB for tiny model)
      await downloadModel('tiny', (progress) => {
        console.log(`Download progress: ${Math.round(progress * 100)}%`);
      });
    }

    // Get the local path and initialize
    const modelPath = getModelPath('tiny');
    await whisper.initialize({ filePath: modelPath });
  };

  const transcribe = async () => {
    if (!whisper.isReady) return;

    const result = await whisper.transcribeFile('/path/to/audio.wav', {
      language: 'en',
    });

    console.log('Transcription:', result.result);
  };

  return null; // UI implementation
}
```

**Available Models**: tiny (75MB), base (142MB), small (466MB), medium (1.5GB), large-v3 (3.1GB) - [full list](#available-models)

## Core Concepts

Check the hook state before using transcription:

```typescript
const whisper = useWhisper();

if (whisper.isReady) {
  // Safe to transcribe
  await whisper.transcribeFile(path);
}

// Available properties
whisper.isReady           // Ready to transcribe
whisper.isLoading        // Currently initializing
whisper.modelPath        // Path to the model file
whisper.isUsingGpu       // GPU is enabled
whisper.error            // Any errors from init

## API Reference

### useWhisper Hook

Main hook for transcription. Returns state and methods.

```typescript
whisper.isLoading      // Initializing
whisper.isReady        // Ready to transcribe
whisper.isTranscribing // Running transcription
whisper.isRecording    // Recording (real-time mode)
whisper.transcript     // Current result
whisper.segments       // Word-level segments with timing
whisper.error          // Any errors
whisper.isUsingGpu     // GPU enabled
whisper.modelPath      // Path to model file
```

#### Methods

##### initialize(options)

Load a model and prepare for transcription.

```typescript
await whisper.initialize({
  filePath: '/path/to/model.bin',
  useGpu: true,                  // optional
  useCoreMLIos: true,            // optional
  useFlashAttn: false,           // optional
});
```

##### transcribeFile(filePath, options)

Transcribe an audio file.

```typescript
const result = await whisper.transcribeFile('/path/to/audio.wav', {
  language: 'en',
  translate: false,
  temperature: 0.5,
  onProgress: (p) => console.log(`${p}%`),
});

console.log(result.result);    // Full transcript
console.log(result.segments);  // Segments with timing
```

Options: `language`, `translate`, `temperature`, `samplingStrategy` ('greedy'|'beamsearch'), `enableVad`, `vadThreshold`, `minSpeechDurationMs`, `minSilenceDurationMs`, `onProgress`, `onNewSegments`, and more.

##### transcribeBuffer(audioData, options)

Transcribe audio from memory (no disk writes).

```typescript
const audioData = new Uint8Array(...);
const result = await whisper.transcribeBuffer(audioData, {
  language: 'en',
});
```

Accepts `Uint8Array`, `ArrayBuffer`, or `Float32Array` in WAV format (16-bit PCM, 16kHz, mono).

##### detectLanguage(filePath)

Detect the language of an audio file.

```typescript
const detection = await whisper.detectLanguage('/path/to/audio.wav');

console.log(detection.language);      // Language code ('en', 'es', etc.)
console.log(detection.languageName);  // Full language name
console.log(detection.confidence);    // Confidence score (0-1)
```

##### startLiveTranscription(options, onChunkComplete)

Start real-time transcription from the microphone.

```typescript
await whisper.startLiveTranscription(
  {
    language: 'en',
    temperature: 0.5,
    chunkDurationMs: 15000,
  },
  (event) => {
    console.log('Chunk:', event.chunk?.transcript);
    console.log('Accumulated:', event.accumulatedTranscript);
  }
);
```

Chunks audio automatically and transcribes in real-time. Everything stays in RAM (no disk writes).

##### stop()

Stop current transcription or recording.

```typescript
await whisper.stop();
```

##### release()

Free up the model from memory.

```typescript
await whisper.release();
```

##### clearTranscript()

Clear the transcript.

```typescript
whisper.clearTranscript();
```

### Model Management

#### downloadModel(model, onProgress?)

Download a model from HuggingFace.

```typescript
const modelPath = await downloadModel('tiny', (progress) => {
  console.log(`Downloaded: ${Math.round(progress * 100)}%`);
});
```

Models download once and are cached locally. See [Available Models](#available-models) for all options.

#### isModelDownloaded(model)

Check if a model is already downloaded.

```typescript
const exists = await isModelDownloaded('tiny');
```

#### getModelPath(model)

Get the file path for a model.

```typescript
const path = getModelPath('tiny');
```

#### getDownloadedModels()

List downloaded models.

```typescript
const models = await getDownloadedModels();
```

#### deleteModel(model)

Delete a model to free space.

```typescript
await deleteModel('tiny');
```

### Available Models

Download from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp).

| Model | Size | Best For |
|-------|------|----------|
| tiny | 75 MB | Mobile, fast |
| tiny.en | 75 MB | English only, mobile |
| base | 142 MB | Balanced |
| base.en | 142 MB | English only, balanced |
| small | 466 MB | Good accuracy |
| small.en | 466 MB | English only, good accuracy |
| medium | 1.5 GB | High accuracy |
| medium.en | 1.5 GB | English only, high accuracy |
| large-v1 | 2.9 GB | Best accuracy |
| large-v2 | 2.9 GB | Best accuracy |
| large-v3 | 3.1 GB | Best accuracy |
| large-v3-turbo | 1.6 GB | Best accuracy, faster |

Models are cached in `Documents/whisper-models/` (iOS) and the app's documents folder (Android).

## Advanced Options

### Real-Time Transcription

```typescript
await whisper.startLiveTranscription(
  {
    language: 'en',
    chunkDurationMs: 5000,
  },
  (event) => {
    console.log('Chunk:', event.chunk?.transcript);
    console.log('Accumulated:', event.accumulatedTranscript);
  }
);

await whisper.stop();
```

Audio stays in memory (no disk writes). ~32KB per second at 16kHz mono.

### Temperature & Sampling

```typescript
await whisper.transcribeFile(path, {
  temperature: 0.5,
  samplingStrategy: 'greedy', // or 'beamsearch'
  beamSearchBeamSize: 5,
});
```

`temperature`: 0 = deterministic, 1+ = random

### Voice Activity Detection

```typescript
await whisper.transcribeFile(path, {
  enableVad: true,
  vadThreshold: 0.6,
  minSpeechDurationMs: 500,
  minSilenceDurationMs: 300,
});
```

### Word-Level Timing

```typescript
await whisper.transcribeFile(path, {
  tokenTimestamps: true,
  suppressBlank: true,
  suppressNst: true,
});
```

## Complete Examples

### Example 1: Basic Workflow

```typescript
import React, { useState } from 'react';
import { View, Button, Text, Alert } from 'react-native';
import { useWhisper, downloadModel, getModelPath, isModelDownloaded } from 'expo-whisper';

export default function BasicExample() {
  const whisper = useWhisper();
  const [status, setStatus] = useState('Not initialized');

  const setup = async () => {
    try {
      setStatus('Preparing...');

      // Check and download model
      if (!await isModelDownloaded('tiny')) {
        setStatus('Downloading model...');
        await downloadModel('tiny');
      }

      // Initialize
      const path = getModelPath('tiny');
      await whisper.initialize({ filePath: path });

      setStatus(`Ready - Model: ${whisper.modelPath}`);
    } catch (error) {
      Alert.alert('Error', String(error));
    }
  };

  return (
    <View style={{ padding: 20 }}>
      <Text>{status}</Text>
      <Button title="Setup" onPress={setup} />
      <Button
        title="Transcribe"
        onPress={() => whisper.transcribeFile('/path/to/audio.wav')}
        disabled={!whisper.isReady}
      />
    </View>
  );
}
```

### Example 2: Real-Time Transcription

```typescript
import React, { useState } from 'react';
import { View, Button, Text, ScrollView } from 'react-native';
import { useWhisper } from 'expo-whisper';

export default function RealtimeExample() {
  const whisper = useWhisper();
  const [listening, setListening] = useState(false);

  const startListening = async () => {
    if (!whisper.isReady) return;

    try {
      await whisper.startLiveTranscription({ language: 'en' });
      setListening(true);
    } catch (error) {
      console.error(error);
    }
  };

  const stopListening = async () => {
    await whisper.stop();
    setListening(false);
  };

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Button
        title={listening ? 'Listening...' : 'Start'}
        onPress={listening ? stopListening : startListening}
        color={listening ? 'red' : 'blue'}
      />
      <ScrollView style={{ flex: 1, marginTop: 20 }}>
        <Text>{whisper.transcript}</Text>
      </ScrollView>
    </View>
  );
}
```

### Example 3: Advanced Configuration

```typescript
import { useWhisper, downloadModel, getModelPath } from 'expo-whisper';

export default function AdvancedExample() {
  const whisper = useWhisper();

  const transcribeWithOptions = async () => {
    const result = await whisper.transcribeFile('/path/to/audio.wav', {
      language: 'en',
      translate: false,
      temperature: 0.3,
      samplingStrategy: 'beamsearch',
      beamSearchBeamSize: 5,
      enableVad: true,
      vadThreshold: 0.5,
      tokenTimestamps: true,
      initialPrompt: 'transcribe technical content',
      onProgress: (p) => console.log(`${p}% done`),
    });

    console.log(result.result);
    console.log('Segments:', result.segments);
  };

  return null;
}
```

## Platform-Specific Details

### iOS

- Models: `Documents/whisper-models/`
- Audio format: WAV (16-bit PCM, 16kHz, mono)
- GPU: Metal acceleration
- Permissions: NSMicrophoneUsageDescription

### Android

- Models: App document directory
- Audio format: WAV (platform encoding)
- GPU: NNAPI acceleration
- Permissions: RECORD_AUDIO (automatic)

## Performance Considerations

1. **Model Selection**: Smaller models are faster but less accurate
2. **GPU Usage**: Automatically enabled when available
3. **Memory**: Release context when done (`whisper.release()`)
4. **Caching**: Models are cached locally after download
5. **Real-Time**: Use smaller models for responsive live transcription

## Troubleshooting

### Model Download Fails

Check internet connection and available storage space.

### Initialization Error

Verify the model file path exists:

```typescript
const path = getModelPath('tiny');
const exists = await isModelDownloaded('tiny');
```

### Slow Transcription

- Use smaller model (tiny, base)
- Enable GPU: `useGpu: true`
- Check device resources
- Use real-time mode for streaming

### Not Initialized

Always check `isReady` before transcribing:

```typescript
if (!whisper.isReady) {
  console.error('Initialize first');
  return;
}
```

### Buffer Recording Issues

**"No audio data captured"**
- Check microphone permissions are granted
- Ensure device microphone works (test with voice memo app)
- Verify minimum 0.5 seconds of audio captured

**"Audio conversion failed"** (iOS)
- Resampling from hardware format (44.1kHz/48kHz) to 16kHz is automatic
- Ensure AVAudioEngine is initialized before recording

**"Buffer overflow"**
- Chunk duration is auto-capped at 5 seconds (160KB max)
- Reduce `chunkDurationMs` if needed
- Monitor device memory on low-end devices

## TypeScript Types

```typescript
import type {
  WhisperContextOptions,
  TranscribeFileOptions,
  TranscribeRealtimeOptions,
  TranscribeResult,
  TranscribeSegment,
  ChunkedRealtimeEvent,
  LanguageDetectionResult,
  WhisperModelSize,
} from 'expo-whisper';
```

## License

MIT

## Credits

- Built on [whisper.cpp](https://github.com/ggerganov/whisper.cpp)
- Based on [OpenAI's Whisper](https://github.com/openai/whisper)
- Models from [HuggingFace](https://huggingface.co/ggerganov/whisper.cpp)
