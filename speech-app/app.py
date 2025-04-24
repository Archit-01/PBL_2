from flask import Flask, render_template, request, jsonify, send_from_directory
import speech_recognition as sr
import requests
import os
from datetime import datetime
import tempfile
import uuid
import wave
import json

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'static/audio'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

recognizer = sr.Recognizer()
GROQ_API_KEY = "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"  # Replace with your key

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/process_audio', methods=['POST'])
def process_audio():
    try:
        mode = request.form.get('mode', 'online')
        if 'audio' not in request.files:
            return jsonify({'error': 'No audio file provided'}), 400
            
        audio_file = request.files['audio']
        temp_filename = os.path.join(app.config['UPLOAD_FOLDER'], f"temp_{uuid.uuid4()}.wav")
        audio_file.save(temp_filename)

        # Validate WAV file
        try:
            with wave.open(temp_filename, 'rb') as wav_file:
                if wav_file.getnchannels() != 1:
                    return jsonify({'error': 'Audio must be mono (1 channel)'}), 400
        except wave.Error:
            return jsonify({'error': 'Invalid WAV file format'}), 400

        with sr.AudioFile(temp_filename) as source:
            audio_data = recognizer.record(source)
            
        if mode == 'online':
            text = recognize_online(audio_data)
        else:
            text = recognize_offline(audio_data)
        
        os.remove(temp_filename)
        return jsonify({'text': text})
    
    except Exception as e:
        if 'temp_filename' in locals() and os.path.exists(temp_filename):
            os.remove(temp_filename)
        return jsonify({'error': str(e)}), 500

def recognize_online(audio_data):
    try:
        api_key = os.getenv("GROQ_API_KEY") or GROQ_API_KEY
        if not api_key:
            return "Error: Groq API key not found."

        # Save audio to temporary file
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_audio:
            temp_audio.write(audio_data.get_wav_data())
            temp_audio_path = temp_audio.name

        try:
            # Correct Groq API endpoint for speech-to-text
            with open(temp_audio_path, 'rb') as audio_file:
                response = requests.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "multipart/form-data"
                    },
                    files={
                        "file": (os.path.basename(temp_audio_path), audio_file, 'audio/wav'),
                        "model": (None, "whisper-1")
                    }
                )

            if response.status_code == 200:
                return response.json().get("text", "[No text recognized]")
            return f"Error: {response.text}"
        finally:
            os.remove(temp_audio_path)
    except Exception as e:
        return f"Online recognition error: {str(e)}"

# ... [rest of the code remains the same as previous version] ...

def recognize_offline(audio_data):
    try:
        return recognizer.recognize_google(audio_data)
    except sr.UnknownValueError:
        return "Could not understand audio"
    except sr.RequestError:
        return "API unavailable"

@app.route('/summarize', methods=['POST'])
def summarize():
    try:
        text = request.json.get('text')
        if not text:
            return jsonify({'error': 'No text provided'}), 400
        
        summary = summarize_using_groq(text)
        mom = generate_mom(summary)
        
        return jsonify({
            'summary': summary,
            'mom': mom
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def summarize_using_groq(text):
    try:
        api_key = os.getenv("GROQ_API_KEY") or GROQ_API_KEY
        if not api_key:
            return "Error: Groq API key not found."

        api_url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "llama3-70b-8192",
            "messages": [
                {"role": "system", "content": "You are a helpful assistant that summarizes text."},
                {"role": "user", "content": f"Summarize the following text into key points: {text}"}
            ],
            "temperature": 0.5
        }

        response = requests.post(api_url, headers=headers, json=payload)
        if response.status_code == 200:
            return response.json()["choices"][0]["message"]["content"]
        return f"Error in summarization: {response.text}"
    except Exception as e:
        return f"Error in summarization: {str(e)}"

def generate_mom(summary):
    date_str = datetime.now().strftime("%B %d, %Y at %I:%M %p")
    return f"Minutes of Meeting\n\nDate: {date_str}\n\nKey Discussion Points:\n{summary}"

@app.route('/export_pdf', methods=['POST'])
def export_pdf():
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib import colors

        content = request.json.get('content')
        if not content:
            return jsonify({'error': 'No content provided'}), 400

        temp_pdf = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
        temp_pdf_path = temp_pdf.name
        temp_pdf.close()

        doc = SimpleDocTemplate(temp_pdf_path, pagesize=letter)
        styles = getSampleStyleSheet()
        
        title_style = ParagraphStyle(
            'Title',
            parent=styles['Heading1'],
            fontSize=16,
            leading=22,
            spaceAfter=20,
            alignment=TA_LEFT,
            textColor=colors.darkblue
        )
        
        content_style = ParagraphStyle(
            'Content',
            parent=styles['BodyText'],
            fontSize=12,
            leading=16,
            spaceAfter=12,
            alignment=TA_LEFT
        )
        
        parts = content.split("\n\n")
        story = []
        
        story.append(Paragraph("Minutes of Meeting", title_style))
        date_str = datetime.now().strftime("%B %d, %Y at %I:%M %p")
        story.append(Paragraph(f"<b>Date:</b> {date_str}", content_style))
        story.append(Spacer(1, 20))
        
        for part in parts:
            if part.strip():
                if part.startswith("Key Discussion Points:"):
                    story.append(Paragraph("<b>Key Discussion Points:</b>", content_style))
                    story.append(Spacer(1, 12))
                else:
                    formatted_text = part.replace("\n- ", "<br/>• ").replace("- ", "• ")
                    story.append(Paragraph(formatted_text, content_style))
        
        doc.build(story)
        
        return send_from_directory(
            directory=os.path.dirname(temp_pdf_path),
            path=os.path.basename(temp_pdf_path),
            as_attachment=True,
            mimetype='application/pdf'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if 'temp_pdf_path' in locals() and os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)

if __name__ == '__main__':
    app.run(debug=True)


# python3 -m venv venv
# source venv/bin/activate  # On Mac/Linux

# deactivate