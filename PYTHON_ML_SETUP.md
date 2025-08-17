# Python ML Integration Setup Guide

This guide explains how to configure the Python machine learning integration for the Poems India platform's content analysis feature.

## Overview

The Basic Check functionality uses Python-based NLP and ML models to analyze submitted content for:
- **Quality scoring** (0-100)
- **Style detection** (Contemporary, Lyrical, Narrative, etc.)
- **Theme extraction** (Love, Nature, Identity, etc.)
- **Plagiarism detection** (basic implementation)
- **Readability analysis** (Flesch-Kincaid scores)
- **Sentiment analysis** (positive/negative/neutral scores)

## Prerequisites

### 1. Python Installation
- **Python 3.8+** required
- Verify installation: `python3 --version`

### 2. System Dependencies

#### macOS:
```bash
# Install Python if not present
brew install python3

# Install required system packages
brew install gcc
```

#### Ubuntu/Debian:
```bash
# Install Python and dependencies
sudo apt update
sudo apt install python3 python3-pip python3-dev build-essential

# Install additional dependencies for some packages
sudo apt install python3-distutils python3-setuptools
```

#### Windows:
- Download Python from [python.org](https://python.org)
- Ensure "Add to PATH" is checked during installation
- Install Microsoft C++ Build Tools if needed

## Installation Steps

### 1. Install Python Dependencies

Navigate to your backend directory and run:

```bash
# Create virtual environment (recommended)
python3 -m venv venv

# Activate virtual environment
# On macOS/Linux:
source venv/bin/activate
# On Windows:
# venv\Scripts\activate

# Install required packages
pip install nltk==3.8.1 spacy==3.4.4 textstat==0.7.3 scikit-learn==1.1.3

# Install spaCy language model
python -m spacy download en_core_web_sm

# Optional: Install advanced ML packages for better analysis
pip install transformers==4.25.1 torch==1.13.1
```

### 2. Environment Configuration

Add these variables to your `.env` file:

```env
# Python ML Configuration
PYTHON_PATH=/usr/local/bin/python3
PYTHON_SCRIPTS_DIR=./python-scripts
ANALYSIS_TIMEOUT=30000
ML_MODEL_PATH=./models

# Optional: Advanced ML features
ENABLE_TRANSFORMERS=false
ENABLE_ADVANCED_PLAGIARISM=false
```

### 3. Directory Structure

Ensure your backend has this structure:
```
pi-backend/
├── python-scripts/
│   └── analyze.py
├── services/
│   └── analysisService.js
├── models/           # Optional: for custom ML models
└── .env
```

### 4. Test the Integration

#### Check Python Environment:
```bash
# Test basic Python
python3 -c "import nltk, spacy, textstat, sklearn; print('All packages installed successfully')"

# Test spaCy model
python3 -c "import spacy; nlp = spacy.load('en_core_web_sm'); print('spaCy model loaded successfully')"
```

#### Test via API:
```bash
# Start your backend server
npm run start:dev

# Test the health check endpoint (requires reviewer auth)
curl -X GET http://localhost:3000/api/submissions/analysis/health \
  -H "Authorization: Bearer YOUR_TOKEN"

# Test analysis endpoint (requires reviewer auth)
curl -X POST http://localhost:3000/api/submissions/SUBMISSION_ID/analyze \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PYTHON_PATH` | Auto-detected | Path to Python executable |
| `PYTHON_SCRIPTS_DIR` | `./python-scripts` | Directory containing analysis scripts |
| `ANALYSIS_TIMEOUT` | `30000` | Timeout in milliseconds |
| `ML_MODEL_PATH` | `./models` | Directory for custom ML models |

### Auto-Detection Logic

The system automatically detects Python path based on OS:
- **macOS**: `/usr/local/bin/python3`
- **Linux**: `/usr/bin/python3`
- **Windows**: `python` (uses system PATH)

## Advanced Features

### 1. Custom ML Models
Place custom models in the `ML_MODEL_PATH` directory:
```
models/
├── custom_style_classifier.pkl
├── plagiarism_detector.pkl
└── theme_extractor.pkl
```

### 2. Enhanced Plagiarism Detection
To enable advanced plagiarism detection:
```bash
pip install sentence-transformers==2.2.2
```

Set in `.env`:
```env
ENABLE_ADVANCED_PLAGIARISM=true
```

### 3. Transformer Models
For state-of-the-art analysis:
```bash
pip install transformers torch
```

Set in `.env`:
```env
ENABLE_TRANSFORMERS=true
```

## Troubleshooting

### Common Issues

#### 1. "Python script not found"
- Verify `PYTHON_SCRIPTS_DIR` path in `.env`
- Ensure `analyze.py` exists in the scripts directory

#### 2. "Module not found" errors
```bash
# Check if packages are installed in correct environment
pip list | grep -E "(nltk|spacy|textstat|sklearn)"

# Reinstall if needed
pip install --upgrade nltk spacy textstat scikit-learn
```

#### 3. spaCy model not found
```bash
# Download the model again
python -m spacy download en_core_web_sm

# Verify it's installed
python -c "import spacy; spacy.load('en_core_web_sm')"
```

#### 4. Permission errors on Unix systems
```bash
# Make sure script is executable
chmod +x python-scripts/analyze.py

# Check Python path permissions
ls -la $(which python3)
```

#### 5. Timeout errors
- Increase `ANALYSIS_TIMEOUT` in `.env`
- Check if Python packages are installed correctly
- Monitor system resources during analysis

### Performance Optimization

#### 1. Use Virtual Environment
Always use a Python virtual environment to avoid conflicts:
```bash
python3 -m venv venv
source venv/bin/activate  # Unix
# or venv\Scripts\activate  # Windows
pip install -r requirements.txt
```

#### 2. Preload Models
For better performance, consider preloading spaCy models:
```python
# In analyze.py, load models once at startup
nlp = spacy.load("en_core_web_sm")
```

#### 3. Caching
Implement result caching for repeated analysis requests.

## API Endpoints

### Analysis Endpoint
```http
POST /api/submissions/:id/analyze
Authorization: Bearer <token>
Content-Type: application/json

Response:
{
  "submissionId": "...",
  "analysis": {
    "quality": 85,
    "style": "Contemporary",
    "themes": ["Love", "Nature"],
    "plagiarism": 5,
    "confidence": 92,
    "description": "Well-crafted piece with strong imagery...",
    "readability": {
      "flesch_ease": 70.5,
      "grade_level": 8.2
    },
    "sentiment": {
      "positive": 0.7,
      "negative": 0.1,
      "neutral": 0.2,
      "compound": 0.6
    }
  },
  "status": "completed",
  "processing_time_ms": 1500
}
```

### Health Check Endpoint
```http
GET /api/submissions/analysis/health
Authorization: Bearer <token>

Response:
{
  "service_available": true,
  "python_path": "/usr/local/bin/python3",
  "environment_check": {
    "status": "ok",
    "python_version": "3.9.7"
  }
}
```

## Fallback Behavior

When Python analysis fails, the system automatically:
1. Returns fallback analysis results
2. Logs the error for debugging
3. Continues operation without crashing
4. Provides clear status indicators

## Production Deployment

### Docker Configuration
```dockerfile
# In your Dockerfile
FROM node:18

# Install Python and dependencies
RUN apt-get update && apt-get install -y python3 python3-pip
RUN pip3 install nltk spacy textstat scikit-learn
RUN python3 -m spacy download en_core_web_sm

# Copy application files
COPY . .
RUN npm install

EXPOSE 3000
CMD ["npm", "start"]
```

### Process Management
Consider using PM2 with environment variables:
```json
{
  "apps": [{
    "name": "pi-backend",
    "script": "server.js",
    "env": {
      "PYTHON_PATH": "/usr/bin/python3",
      "ANALYSIS_TIMEOUT": "45000"
    }
  }]
}
```

## Support

For issues with Python integration:
1. Check the health endpoint: `/api/submissions/analysis/health`
2. Review server logs for Python errors
3. Verify all dependencies are installed
4. Test Python script independently: `python3 python-scripts/analyze.py`

The system is designed to gracefully handle Python failures and continue operating with fallback analysis.