import React, { useState, useCallback, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
	StyleSheet,
	Text,
	View,
	TouchableOpacity,
	ScrollView,
	ActivityIndicator,
	Alert,
	Platform,
} from 'react-native';
import {
	useWhisper,
	downloadModel,
	isModelDownloaded,
	getModelPath,
	WhisperModelSize,
	MODEL_SIZES,
	AudioRecorder,
	requestMicrophonePermissions,
} from './modules/expo-whisper';

const AVAILABLE_MODELS: WhisperModelSize[] = [
	'tiny',
	'tiny.en',
	'base',
	'base.en',
	'small',
	'small.en',
	'medium',
	'medium.en',
	'large-v1',
	'large-v2',
	'large-v3',
	'large-v3-turbo',
];

export default function App() {
	const whisper = useWhisper();
	// Use our own AudioRecorder class instead of useAudioRecorder hook
	// to avoid expo-audio crash when getStatus() is called before prepare()
	const audioRecorderRef = useRef<AudioRecorder | null>(null);

	const [selectedModel, setSelectedModel] = useState<WhisperModelSize>('tiny');
	const [downloadProgress, setDownloadProgress] = useState(0);
	const [isDownloading, setIsDownloading] = useState(false);
	const [logs, setLogs] = useState<string[]>(['Welcome to Whisper App']);
	const [hasPermission, setHasPermission] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [isRealtimeActive, setIsRealtimeActive] = useState(false);

	const log = useCallback((message: string) => {
		setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
	}, []);

	// Request microphone permission on mount
	useEffect(() => {
		(async () => {
			const granted = await requestMicrophonePermissions();
			setHasPermission(granted);
			if (granted) {
				log('Microphone permission granted');
			} else {
				log('Microphone permission denied');
			}
		})();
	}, [log]);


	const handleDownloadModel = async () => {
		try {
			setIsDownloading(true);
			setDownloadProgress(0);
			log(`Downloading ${selectedModel} model...`);

			const modelPath = await downloadModel(selectedModel, (progress) => {
				setDownloadProgress(progress);
			});

			log(`Model downloaded to: ${modelPath}`);
			setIsDownloading(false);
		} catch (error) {
			log(`Download error: ${error}`);
			setIsDownloading(false);
			Alert.alert('Download Error', String(error));
		}
	};

	const handleInitialize = async () => {
		try {
			const downloaded = await isModelDownloaded(selectedModel);
			if (!downloaded) {
				Alert.alert('Model Not Found', 'Please download the model first');
				return;
			}

			log(`Initializing ${selectedModel} model...`);
			const modelPath = getModelPath(selectedModel);
			await whisper.initialize({ filePath: modelPath });
			log(`Model initialized! GPU: ${whisper.isUsingGpu}`);
		} catch (error) {
			log(`Init error: ${error}`);
			Alert.alert('Initialization Error', String(error));
		}
	};

	const handleStartRecording = async () => {
		if (!whisper.isReady) {
			Alert.alert('Not Ready', 'Please initialize the model first');
			return;
		}

		if (!hasPermission) {
			const granted = await requestMicrophonePermissions();
			if (!granted) {
				Alert.alert('Permission Denied', 'Microphone permission is required');
				return;
			}
			setHasPermission(true);
		}

		try {
			log('Starting recording (buffer mode)...');

			// Create a new AudioRecorder instance and set context ID
			if (!whisper.id) {
				Alert.alert('Error', 'Model context not initialized');
				return;
			}

			if (!audioRecorderRef.current) {
				audioRecorderRef.current = new AudioRecorder();
				audioRecorderRef.current.setContextId(whisper.id);
			}

			await audioRecorderRef.current.start();
			setIsRecording(true);
			log('Recording started');
		} catch (error) {
			log(`Recording error: ${error}`);
			Alert.alert('Recording Error', String(error));
		}
	};

	const handleStopRecording = async () => {
		try {
			log('Stopping recording...');

			if (!audioRecorderRef.current) {
				log('No recorder available');
				return;
			}

			const audioData = await audioRecorderRef.current.stop();
			setIsRecording(false);

			if (audioData && audioData.byteLength > 0) {
				log(`Recording stopped: ${audioData.byteLength} bytes captured (buffer mode)`);

				log('Starting transcription...');

				try {
					// Transcribe directly from audio buffer (no file writes)
					const result = await whisper.transcribeBuffer(audioData, {
						language: 'en',
						onProgress: (progress) => {
							log(`Transcription progress: ${progress}%`);
						},
					});

					log(`Transcription complete!`);
					log(`Result: ${JSON.stringify(result)}`);

					if (result && result.result) {
						log(`Transcript: ${result.result.substring(0, 100)}`);
					} else {
						log('No transcription result received');
					}
				} catch (transcribeError) {
					log(`Transcription error: ${transcribeError}`);
					throw transcribeError;
				}
			} else {
				log('No audio data available');
			}
		} catch (error) {
			setIsRecording(false);
			log(`Stop/Transcribe error: ${error}`);
			Alert.alert('Error', String(error));
		}
	};

	const handleRelease = async () => {
		try {
			await whisper.release();
			log('Context released');
		} catch (error) {
			log(`Release error: ${error}`);
		}
	};

	const handleToggleRealtime = async () => {
		if (!whisper.isReady) {
			Alert.alert('Not Ready', 'Please initialize the model first');
			return;
		}

		if (!hasPermission) {
			const granted = await requestMicrophonePermissions();
			if (!granted) {
				Alert.alert('Permission Denied', 'Microphone permission is required');
				return;
			}
			setHasPermission(true);
		}

		// If already active, stop realtime transcription
		if (isRealtimeActive) {
			try {
				log('Stopping realtime transcription...');
				await whisper.stop();
				setIsRealtimeActive(false);
				log('Realtime transcription stopped');
			} catch (error) {
				log(`Stop error: ${error}`);
				setIsRealtimeActive(false);
				Alert.alert('Error', String(error));
			}
			return;
		}

		// Start chunked realtime transcription
		try {
			log('Starting realtime transcription - speak now! (buffer mode)');
			setIsRealtimeActive(true);
			whisper.clearTranscript();

			// Native layer handles microphone streaming + transcription
			// Hook automatically updates whisper.transcript as chunks complete
			await whisper.startLiveTranscription(
				{
					language: 'en',
					translate: false,
					chunkDurationMs: 3000, // 3 seconds per chunk for testing
				},
				(event) => {
					if (event.chunk) {
						log(`Chunk ${event.currentChunkIndex}: "${event.chunk.transcript}"`);  
					}
					if (event.accumulatedTranscript) {
						log(`Accumulated: "${event.accumulatedTranscript}"`);
					}
					if (!event.isCapturing) {
						log('Realtime transcription finished');
						setIsRealtimeActive(false);
					}
				}
			);

			log('Streaming from microphone...');
		} catch (error) {
			log(`Realtime error: ${error}`);
			setIsRealtimeActive(false);
			Alert.alert('Error', String(error));
		}
	};

	return (
		<View style={styles.container}>
			<StatusBar style="light" />

			<View style={styles.header}>
				<Text style={styles.title}>Whisper Speech Recognition</Text>
				<Text style={styles.subtitle}>On-device transcription with whisper.cpp</Text>
			</View>

			{/* Model Selection */}
			<View style={styles.section}>
				<Text style={styles.sectionTitle}>Select Model</Text>
				<ScrollView horizontal showsHorizontalScrollIndicator={false}>
					<View style={styles.modelButtons}>
						{AVAILABLE_MODELS.map((model) => (
							<TouchableOpacity
								key={model}
								style={[
									styles.modelButton,
									selectedModel === model && styles.modelButtonSelected,
								]}
								onPress={() => setSelectedModel(model)}
							>
								<Text
									style={[
										styles.modelButtonText,
										selectedModel === model && styles.modelButtonTextSelected,
									]}
								>
									{model}
								</Text>
								<Text style={styles.modelSize}>{MODEL_SIZES[model]} MB</Text>
							</TouchableOpacity>
						))}
					</View>
				</ScrollView>
			</View>

			{/* Download Progress */}
			{isDownloading && (
				<View style={styles.progressContainer}>
					<View style={[styles.progressBar, { width: `${downloadProgress * 100}%` }]} />
					<Text style={styles.progressText}>
						Downloading: {Math.round(downloadProgress * 100)}%
					</Text>
				</View>
			)}

			{/* Action Buttons */}
			<View style={styles.section}>
				<View style={styles.buttonRow}>
					<TouchableOpacity
						style={[styles.button, styles.downloadButton]}
						onPress={handleDownloadModel}
						disabled={isDownloading}
					>
						<Text style={styles.buttonText}>
							{isDownloading ? 'Downloading...' : 'Download Model'}
						</Text>
					</TouchableOpacity>

					<TouchableOpacity
						style={[styles.button, styles.initButton]}
						onPress={handleInitialize}
						disabled={whisper.isLoading}
					>
						{whisper.isLoading ? (
							<ActivityIndicator color="#fff" />
						) : (
							<Text style={styles.buttonText}>Initialize</Text>
						)}
					</TouchableOpacity>
				</View>

				<View style={styles.buttonRow}>
					<TouchableOpacity
						style={[
							styles.button,
							isRecording ? styles.stopButton : styles.recordButton,
						]}
						onPress={isRecording ? handleStopRecording : handleStartRecording}
						disabled={!whisper.isReady || whisper.isLoading}
					>
						<Text style={styles.buttonText}>
							{isRecording ? 'Stop & Transcribe' : 'Start Recording'}
						</Text>
					</TouchableOpacity>

					<TouchableOpacity
						style={[styles.button, styles.releaseButton]}
						onPress={handleRelease}
						disabled={!whisper.isReady}
					>
						<Text style={styles.buttonText}>Release</Text>
					</TouchableOpacity>
				</View>

				<View style={styles.buttonRow}>
					<TouchableOpacity
						style={[
							styles.button,
							isRealtimeActive ? styles.stopButton : styles.realtimeButton,
						]}
						onPress={handleToggleRealtime}
						disabled={!whisper.isReady || whisper.isLoading}
					>
						<Text style={styles.buttonText}>
							{isRealtimeActive ? 'Stop Realtime' : 'Start Realtime'}
						</Text>
					</TouchableOpacity>
				</View>
			</View>

			{/* Status */}
			<View style={styles.statusContainer}>
				<View style={styles.statusRow}>
					<View style={[styles.statusDot, hasPermission && styles.statusDotActive]} />
					<Text style={styles.statusText}>
						Mic: {hasPermission ? 'Granted' : 'Not Granted'}
					</Text>
				</View>
				<View style={styles.statusRow}>
					<View style={[styles.statusDot, whisper.isReady && styles.statusDotActive]} />
					<Text style={styles.statusText}>
						Model: {whisper.isReady ? 'Ready' : 'Not Initialized'}
					</Text>
				</View>
				{isRecording && (
					<View style={styles.statusRow}>
						<View style={[styles.statusDot, styles.statusDotRecording]} />
						<Text style={styles.statusText}>Recording...</Text>
					</View>
				)}
				{whisper.isTranscribing && (
					<View style={styles.statusRow}>
						<ActivityIndicator size="small" color="#007AFF" />
						<Text style={[styles.statusText, { marginLeft: 8 }]}>Transcribing...</Text>
					</View>
				)}
			</View>

			{/* Transcription Result */}
			<View style={styles.resultContainer}>
				<Text style={styles.resultTitle}>Transcription</Text>
				<ScrollView style={styles.resultScroll}>
					<Text style={styles.resultText}>
						{whisper.transcript || 'Transcription will appear here...'}
					</Text>
				</ScrollView>
			</View>

			{/* Logs */}
			<View style={styles.logsContainer}>
				<Text style={styles.logsTitle}>Logs</Text>
				<ScrollView style={styles.logsScroll}>
					{logs.map((logMsg, index) => (
						<Text key={index} style={styles.logText}>
							{logMsg}
						</Text>
					))}
				</ScrollView>
				<TouchableOpacity
					style={styles.clearButton}
					onPress={() => {
						setLogs([]);
						whisper.clearTranscript();
					}}
				>
					<Text style={styles.clearButtonText}>Clear</Text>
				</TouchableOpacity>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: '#1a1a2e',
		paddingTop: Platform.OS === 'ios' ? 50 : 30,
	},
	header: {
		paddingHorizontal: 20,
		marginBottom: 20,
	},
	title: {
		fontSize: 24,
		fontWeight: 'bold',
		color: '#fff',
	},
	subtitle: {
		fontSize: 14,
		color: '#888',
		marginTop: 4,
	},
	section: {
		paddingHorizontal: 20,
		marginBottom: 16,
	},
	sectionTitle: {
		fontSize: 16,
		fontWeight: '600',
		color: '#fff',
		marginBottom: 10,
	},
	modelButtons: {
		flexDirection: 'row',
		gap: 10,
	},
	modelButton: {
		paddingHorizontal: 16,
		paddingVertical: 10,
		backgroundColor: '#2d2d44',
		borderRadius: 8,
		alignItems: 'center',
	},
	modelButtonSelected: {
		backgroundColor: '#007AFF',
	},
	modelButtonText: {
		color: '#fff',
		fontWeight: '600',
	},
	modelButtonTextSelected: {
		color: '#fff',
	},
	modelSize: {
		color: '#888',
		fontSize: 12,
		marginTop: 2,
	},
	progressContainer: {
		marginHorizontal: 20,
		marginBottom: 16,
		height: 30,
		backgroundColor: '#2d2d44',
		borderRadius: 8,
		overflow: 'hidden',
		justifyContent: 'center',
	},
	progressBar: {
		position: 'absolute',
		left: 0,
		top: 0,
		bottom: 0,
		backgroundColor: '#007AFF',
	},
	progressText: {
		color: '#fff',
		textAlign: 'center',
		fontWeight: '600',
	},
	buttonRow: {
		flexDirection: 'row',
		gap: 10,
		marginBottom: 10,
	},
	button: {
		flex: 1,
		paddingVertical: 14,
		borderRadius: 8,
		alignItems: 'center',
		justifyContent: 'center',
	},
	downloadButton: {
		backgroundColor: '#16213e',
		borderWidth: 1,
		borderColor: '#007AFF',
	},
	initButton: {
		backgroundColor: '#007AFF',
	},
	recordButton: {
		backgroundColor: '#e94560',
	},
	stopButton: {
		backgroundColor: '#ff6b6b',
	},
	releaseButton: {
		backgroundColor: '#6c757d',
	},
	realtimeButton: {
		backgroundColor: '#9c27b0',
	},
	bufferModeActive: {
		backgroundColor: '#00bcd4',
	},
	bufferModeInactive: {
		backgroundColor: '#4a4a6a',
	},
	buttonText: {
		color: '#fff',
		fontWeight: '600',
		fontSize: 14,
	},
	statusContainer: {
		paddingHorizontal: 20,
		marginBottom: 16,
	},
	statusRow: {
		flexDirection: 'row',
		alignItems: 'center',
		marginBottom: 6,
	},
	statusDot: {
		width: 10,
		height: 10,
		borderRadius: 5,
		backgroundColor: '#6c757d',
		marginRight: 8,
	},
	statusDotActive: {
		backgroundColor: '#28a745',
	},
	statusDotRecording: {
		backgroundColor: '#e94560',
	},
	statusText: {
		color: '#fff',
		fontSize: 14,
	},
	resultContainer: {
		flex: 1,
		marginHorizontal: 20,
		marginBottom: 10,
		backgroundColor: '#2d2d44',
		borderRadius: 12,
		padding: 16,
	},
	resultTitle: {
		color: '#fff',
		fontWeight: '600',
		marginBottom: 10,
	},
	resultScroll: {
		flex: 1,
	},
	resultText: {
		color: '#fff',
		fontSize: 16,
		lineHeight: 24,
	},
	logsContainer: {
		height: 120,
		marginHorizontal: 20,
		marginBottom: 20,
		backgroundColor: '#0f0f1a',
		borderRadius: 8,
		padding: 10,
	},
	logsTitle: {
		color: '#888',
		fontSize: 12,
		marginBottom: 6,
	},
	logsScroll: {
		flex: 1,
	},
	logText: {
		color: '#666',
		fontSize: 11,
		fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
	},
	clearButton: {
		position: 'absolute',
		top: 8,
		right: 10,
	},
	clearButtonText: {
		color: '#007AFF',
		fontSize: 12,
	},
});
