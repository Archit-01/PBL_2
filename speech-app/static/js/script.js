document.addEventListener('DOMContentLoaded', function() {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const summarizeBtn = document.getElementById('summarizeBtn');
    const exportBtn = document.getElementById('exportBtn');
    const resetBtn = document.getElementById('resetBtn');
    const recognizedText = document.getElementById('recognizedText');
    const summaryText = document.getElementById('summaryText');
    const modeRadios = document.querySelectorAll('input[name="mode"]');
    
    let mediaRecorder;
    let mediaStream;
    let audioChunks = [];
    let recordedTexts = [];
    let isRecording = false;
    
    recognizedText.textContent = 'Recognized Text:\n';
    summaryText.textContent = 'Minutes of Meeting:\n';
    
    startBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);
    summarizeBtn.addEventListener('click', generateSummary);
    exportBtn.addEventListener('click', exportToPDF);
    resetBtn.addEventListener('click', resetApp);
    
    async function startRecording() {
        try {
            mediaStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    sampleRate: 16000,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            
            mediaRecorder = new MediaRecorder(mediaStream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = event => {
                audioChunks.push(event.data);
            };
            
            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                await processAudio(audioBlob);
                audioChunks = [];
            };
            
            mediaRecorder.start(1000);
            isRecording = true;
            
            startBtn.disabled = true;
            stopBtn.disabled = false;
            summarizeBtn.disabled = true;
            
        } catch (error) {
            console.error('Error accessing microphone:', error);
            recognizedText.textContent += `Error: ${error.message}\n`;
        }
    }
    
    function stopRecording() {
        if (mediaRecorder && isRecording) {
            mediaRecorder.stop();
            isRecording = false;
            
            mediaStream.getTracks().forEach(track => track.stop());
            
            startBtn.disabled = false;
            stopBtn.disabled = true;
            
            if (recordedTexts.length > 0) {
                summarizeBtn.disabled = false;
            }
        }
    }
    
    // ... [previous code remains the same until processAudio function] ...

async function processAudio(audioBlob) {
    if (!audioBlob || audioBlob.size === 0) {
        recognizedText.textContent += 'Error: Empty audio recording\n';
        return;
    }

    try {
        const mode = document.querySelector('input[name="mode"]:checked').value;
        let audioContext;
        
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const arrayBuffer = await audioBlob.arrayBuffer();
            
            const audioBuffer = await Promise.race([
                audioContext.decodeAudioData(arrayBuffer),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Audio processing timeout')), 5000)
                )
            ]);
            
            const wavBlob = await audioBufferToWav(audioBuffer);
            
            const formData = new FormData();
            formData.append('audio', wavBlob, 'recording.wav');
            formData.append('mode', mode);
            
            const response = await fetch('/process_audio', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Server error: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            if (data.text) {
                recordedTexts.push(data.text);
                recognizedText.textContent += `Recognized: ${data.text}\n`;
                recognizedText.scrollTop = recognizedText.scrollHeight;
                
                if (!summarizeBtn.disabled) {
                    summarizeBtn.disabled = false;
                }
            }
        } finally {
            if (audioContext && audioContext.close) {
                audioContext.close();
            }
        }
    } catch (error) {
        console.error('Error processing audio:', error);
        recognizedText.textContent += `Error: ${error.message}\n`;
        
        // Specific handling for Groq API errors
        if (error.message.includes('Unknown request URL')) {
            recognizedText.textContent += 'API endpoint error. Please check the backend configuration.\n';
        }
    }
}

// ... [rest of the code remains the same] 

    function audioBufferToWav(buffer, targetSampleRate = 16000) {
        const numOfChan = buffer.numberOfChannels;
        const length = buffer.length * numOfChan * 2 + 44;
        const bufferOut = new ArrayBuffer(length);
        const view = new DataView(bufferOut);
        const channels = [];
        let offset = 0;
        let pos = 0;

        const setUint16 = (data) => {
            view.setUint16(pos, data, true);
            pos += 2;
        };

        const setUint32 = (data) => {
            view.setUint32(pos, data, true);
            pos += 4;
        };

        setUint32(0x46464952);
        setUint32(length - 8);
        setUint32(0x45564157);

        setUint32(0x20746d66);
        setUint32(16);
        setUint16(1);
        setUint16(numOfChan);
        setUint32(targetSampleRate);
        setUint32(targetSampleRate * 2 * numOfChan);
        setUint16(numOfChan * 2);
        setUint16(16);

        setUint32(0x61746164);
        setUint32(length - pos - 4);

        for (let i = 0; i < numOfChan; i++) {
            channels.push(buffer.getChannelData(i));
        }

        while (pos < length) {
            for (let i = 0; i < numOfChan; i++) {
                const sample = Math.max(-1, Math.min(1, channels[i][offset]));
                const val = sample < 0 ? sample * 32768 : sample * 32767;
                view.setInt16(pos, val, true);
                pos += 2;
            }
            offset++;
        }

        return new Blob([bufferOut], { type: 'audio/wav' });
    }

    async function generateSummary() {
        if (recordedTexts.length === 0) {
            recognizedText.textContent += 'No text available for summarization\n';
            return;
        }
        
        try {
            const fullText = recordedTexts.join(' ');
            
            const response = await fetch('/summarize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text: fullText })
            });
            
            const data = await response.json();
            
            if (data.error) {
                throw new Error(data.error);
            }
            
            if (data.mom) {
                summaryText.textContent = data.mom;
                exportBtn.disabled = false;
            }
            
        } catch (error) {
            console.error('Error generating summary:', error);
            summaryText.textContent += `Error: ${error.message}\n`;
        }
    }
    
    async function exportToPDF() {
        if (summaryText.textContent.trim() === 'Minutes of Meeting:\n') {
            recognizedText.textContent += 'No summary available to export\n';
            return;
        }
        
        try {
            const response = await fetch('/export_pdf', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ content: summaryText.textContent })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to export PDF');
            }
            
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `meeting_minutes_${new Date().toISOString().slice(0, 10)}.pdf`;
            document.body.appendChild(a);
            a.click();
            
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
        } catch (error) {
            console.error('Error exporting to PDF:', error);
            recognizedText.textContent += `Error exporting PDF: ${error.message}\n`;
        }
    }
    
    function resetApp() {
        if (isRecording) {
            stopRecording();
        }
        
        recordedTexts = [];
        audioChunks = [];
        
        recognizedText.textContent = 'Recognized Text:\n';
        summaryText.textContent = 'Minutes of Meeting:\n';
        
        startBtn.disabled = false;
        stopBtn.disabled = true;
        summarizeBtn.disabled = true;
        exportBtn.disabled = true;
    }
});