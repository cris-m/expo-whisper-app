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
	Whisper,
	downloadModel,
	isModelDownloaded,
	getModelPath,
	requestMicrophonePermissions,
	WHISPER_MODELS,
	MODEL_SIZES,
	type WhisperModelSize,
} from 'expo-whisper';

const AVAILABLE_MODELS = Object.keys(WHISPER_MODELS) as WhisperModelSize[];

export default function App() {
	const whisper = useWhisper();
	const transcriptScrollRef = useRef<ScrollView>(null);
	const logsScrollRef = useRef<ScrollView>(null);
	const contextIdRef = useRef<number | null>(null);

	const [selectedModel, setSelectedModel] = useState<WhisperModelSize>('tiny');
	const [downloadProgress, setDownloadProgress] = useState(0);
	const [isDownloading, setIsDownloading] = useState(false);
	const [logs, setLogs] = useState<string[]>(['Welcome to Whisper App']);
	const [hasPermission, setHasPermission] = useState(false);
	const [isRecording, setIsRecording] = useState(false);
	const [isRealtimeActive, setIsRealtimeActive] = useState(false);
	const [audioLevel, setAudioLevel] = useState(0);
	const [isInitialized, setIsInitialized] = useState(false);
	const [whisperLibInstance, setWhisperLibInstance] = useState<Whisper | null>(null);
	const [transcriptionResult, setTranscriptionResult] = useState<string>('Transcription will appear here...');

	const realtimeOptions = {
		language: 'en',
		temperature: 0.0,
		beamSize: 5,
		translate: false,
		maxTokens: 0,
		suppressBlank: true,
		suppressNst: true,
	};

	const log = useCallback((message: string) => {
		setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
	}, []);

	useEffect(() => {
		(async () => {
			const granted = await requestMicrophonePermissions();
			setHasPermission(granted);
		})();
	}, []);


	const handleDownloadModel = async () => {
		try {
			setIsDownloading(true);
			setDownloadProgress(0);
			log(`Downloading ${selectedModel} model...`);

			await downloadModel(selectedModel, (progress) => {
				setDownloadProgress(progress);
			});

			log('Model downloaded successfully');
			setIsDownloading(false);
		} catch (error) {
			log(`Download error: ${error}`);
			setIsDownloading(false);
			Alert.alert('Download Error', String(error));
		}
	};

	const handleInitialize = async () => {
		try {
			log('Initializing model...');

			let isDownloaded = await isModelDownloaded(selectedModel);
			if (!isDownloaded) {
				try {
					await downloadModel(selectedModel, (progress) => {
						setDownloadProgress(progress);
					});
					isDownloaded = true;
				} catch (downloadError) {
					log(`Failed to download model: ${downloadError}`);
					Alert.alert('Download Failed', `Could not download ${selectedModel} model. Please try again.`);
					return;
				}
			}

			if (whisperLibInstance) {
				try {
					await whisperLibInstance.release();
				} catch (releaseError) {
					log(`Failed to release previous instance: ${releaseError}`);
				}
			}

			const modelPath = getModelPath(selectedModel);
			const whisperLib = await Whisper.initialize({
				modelPath: modelPath,
				useGpu: false,
			});

			setWhisperLibInstance(whisperLib);
			contextIdRef.current = (whisperLib as any).contextId;
			setIsInitialized(true);
			log('Model initialized successfully');
		} catch (error) {
			log(`Initialization error: ${error}`);
			setIsInitialized(false);
			contextIdRef.current = null;
			Alert.alert('Initialization Error', String(error));
		}
	};

	const handleStartRecording = async () => {
		if (!hasPermission) {
			log('Microphone permission required');
			Alert.alert('Permission Denied', 'Microphone permission is required');
			return;
		}

		if (!isInitialized || !whisperLibInstance) {
			log('Model not initialized');
			Alert.alert('Model Not Ready', 'Please initialize the model first');
			return;
		}

		try {
			log('Starting recording...');
			const result = await whisperLibInstance.startRecording();

			if (result.recording) {
				setIsRecording(true);
				setAudioLevel(0);
			}
		} catch (error) {
			log(`Recording error: ${error}`);
			setIsRecording(false);
			Alert.alert('Recording Error', String(error));
		}
	};

	const handleStopRecording = async () => {
		if (!whisperLibInstance) {
			setIsRecording(false);
			return;
		}

		try {
			log('Stopping recording...');
			setIsRecording(false);
			setAudioLevel(0);

			const task = await whisperLibInstance.stopRecording({
				language: 'en',
				temperature: 0.7,
				beamSize: 5,
				onProgress: (progress) => {
					setAudioLevel(progress / 100);
				},
			});

			const text = task.result?.text || 'No text detected';
			log('Transcription complete');
			setTranscriptionResult(text);
		} catch (error) {
			log(`Error: ${error}`);
			setIsRecording(false);
			Alert.alert('Error', String(error));
		}
	};

	const handleRelease = async () => {
		try {
			if (whisperLibInstance) {
				await whisperLibInstance.release();
				contextIdRef.current = null;
				setWhisperLibInstance(null);
				setIsInitialized(false);
				log('Context released');
			}
		} catch (error) {
			log(`Release error: ${error}`);
			Alert.alert('Release Error', String(error));
		}
	};

	const handleToggleRealtime = async () => {
		if (isRealtimeActive) {
			if (!whisperLibInstance) {
				return;
			}

			try {
				log('Stopping realtime...');
				setIsRealtimeActive(false);
				setAudioLevel(0);

				const task = await whisperLibInstance.stopRealtime();
				if (task.result?.text) {
					setTranscriptionResult(task.result.text);
				}
				log('Realtime stopped');
			} catch (error) {
				log(`Stop error: ${error}`);
				setIsRealtimeActive(false);
				setAudioLevel(0);
			}
			return;
		}

		if (!isInitialized || !whisperLibInstance) {
			log('Model not initialized');
			return;
		}

		try {
			log('Starting realtime...');
			setIsRealtimeActive(true);
			setTranscriptionResult('');

			await whisperLibInstance.startRealtime(300, {
				...realtimeOptions,
				onAudioLevel: (level) => {
					setAudioLevel(level);
				},
				onSegment: (segment) => {
					if (segment && segment.text) {
						const startTime = segment.start ? (segment.start / 1000).toFixed(2) : '0.00';
						const endTime = segment.end ? (segment.end / 1000).toFixed(2) : '0.00';
						log(`[DEBUG] Segment object: ${JSON.stringify(segment)}`);
					log(`[Segment] "${segment.text}" (${startTime}s - ${endTime}s)`);
						setTranscriptionResult((prev) => {
							const newText = prev + (prev ? ' ' : '') + segment.text;
							return newText;
						});
					}
				},
			});

			log('Realtime active');
		} catch (error) {
			log(`Start error: ${error}`);
			setIsRealtimeActive(false);
		}
	};

	return (
		<View style={styles.container}>
			<StatusBar style="light" />

			<View style={styles.header}>
				<Text style={styles.title}>Whisper Speech Recognition</Text>
				<Text style={styles.subtitle}>On-device transcription with whisper.cpp</Text>
			</View>

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

			{isDownloading && (
				<View style={styles.progressContainer}>
					<View style={[styles.progressBar, { width: `${downloadProgress * 100}%` }]} />
					<Text style={styles.progressText}>
						Downloading: {Math.round(downloadProgress * 100)}%
					</Text>
				</View>
			)}

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
						disabled={!!whisper.isLoading || whisper.isLoading}
					>
						<Text style={styles.buttonText}>
							{isRecording ? 'Stop & Transcribe' : 'Start Recording'}
						</Text>
					</TouchableOpacity>

					<TouchableOpacity
						style={[styles.button, styles.releaseButton]}
						onPress={handleRelease}
						disabled={!!whisper.isLoading}
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
						disabled={!!whisper.isLoading || whisper.isLoading}
					>
						<Text style={styles.buttonText}>
							{isRealtimeActive ? 'Stop Realtime' : 'Start Realtime'}
						</Text>
					</TouchableOpacity>
				</View>
			</View>

			{isRealtimeActive && (
				<View style={styles.audioLevelContainer}>
					<Text style={styles.audioLevelLabel}>Microphone Level</Text>
					<View style={styles.levelMeterBackground}>
						<View
							style={[
								styles.levelMeterFill,
								{
									width: `${audioLevel * 100}%`,
									backgroundColor: audioLevel > 0.7 ? '#ff3b30' : audioLevel > 0.4 ? '#ff9500' : '#34c759',
								},
							]}
						/>
					</View>
					<Text style={styles.audioLevelValue}>{Math.round(audioLevel * 100)}%</Text>
				</View>
			)}

			<View style={styles.statusContainer}>
				<View style={styles.statusRow}>
					<View style={[styles.statusDot, hasPermission && styles.statusDotActive]} />
					<Text style={styles.statusText}>
						Mic: {hasPermission ? 'Granted' : 'Not Granted'}
					</Text>
				</View>
				<View style={styles.statusRow}>
					<View style={[styles.statusDot, !whisper.isLoading && styles.statusDotActive]} />
					<Text style={styles.statusText}>
						Model: {!whisper.isLoading ? 'Ready' : 'Not Initialized'}
					</Text>
				</View>
				{isRecording && (
					<View style={styles.statusRow}>
						<View style={[styles.statusDot, styles.statusDotRecording]} />
						<Text style={styles.statusText}>Recording...</Text>
					</View>
				)}
				{whisper.progress > 0 && whisper.progress < 100 && (
					<View style={styles.statusRow}>
						<ActivityIndicator size="small" color="#007AFF" />
						<Text style={[styles.statusText, { marginLeft: 8 }]}>Transcribing ({Math.round(whisper.progress)}%)</Text>
					</View>
				)}
			</View>

			<View style={styles.resultContainer}>
				<Text style={styles.resultTitle}>Transcription</Text>
				<ScrollView
					ref={transcriptScrollRef}
					style={styles.resultScroll}
					onContentSizeChange={() =>
						transcriptScrollRef.current?.scrollToEnd({ animated: true })
					}
				>
					<Text style={styles.resultText}>
						{transcriptionResult}
					</Text>
				</ScrollView>
			</View>

			<View style={styles.logsContainer}>
				<Text style={styles.logsTitle}>Logs</Text>
				<ScrollView
					ref={logsScrollRef}
					style={styles.logsScroll}
					onContentSizeChange={() =>
						logsScrollRef.current?.scrollToEnd({ animated: true })
					}
				>
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
						whisper.reset();
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
		fontSize: 20,
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
		marginBottom: 8,
	},
	sectionTitle: {
		fontSize: 12,
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
		marginBottom: 8,
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
	testButton: {
		backgroundColor: '#ff9800',
	},
	buttonText: {
		color: '#fff',
		fontWeight: '600',
		fontSize: 14,
	},
	statusContainer: {
		paddingHorizontal: 20,
		marginBottom: 12,
	},
	statusRow: {
		flexDirection: 'row',
		alignItems: 'center',
		marginTop: 6,
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
	audioLevelContainer: {
		marginHorizontal: 20,
		marginBottom: 10,
		paddingHorizontal: 14,
		paddingVertical: 8,
		backgroundColor: '#2d2d44',
		borderRadius: 8,
	},
	audioLevelLabel: {
		color: '#888',
		fontSize: 11,
		fontWeight: '600',
		marginBottom: 5,
	},
	levelMeterBackground: {
		height: 10,
		backgroundColor: '#1a1a2e',
		borderRadius: 5,
		overflow: 'hidden',
		marginBottom: 4,
	},
	levelMeterFill: {
		height: '100%',
		borderRadius: 4,
	},
	audioLevelValue: {
		color: '#666',
		fontSize: 12,
		textAlign: 'right',
		fontWeight: '500',
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
