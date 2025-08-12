const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

class AnalysisService {
  constructor() {
    // Get Python path from environment or detect automatically
    this.pythonPath = process.env.PYTHON_PATH || this.detectPythonPath();
    this.scriptsDir = process.env.PYTHON_SCRIPTS_DIR || '../models';
    this.timeout = parseInt(process.env.ANALYSIS_TIMEOUT) || 30000; // 30 seconds
  }

  /**
   * Detect Python path based on operating system
   */
  detectPythonPath() {
    const platform = process.platform;
    
    if (platform === 'win32') {
      // Windows common paths
      return 'python'; // Try system PATH first
    } else if (platform === 'darwin') {
      // macOS paths
      return '/usr/local/bin/python3';
    } else {
      // Linux/Unix paths
      return '/usr/bin/python3';
    }
  }

  /**
   * Verify Python environment and required packages
   */
  async verifyPythonEnvironment() {
    try {
      const checkScript = `
import sys
import json
try:
    import nltk
    import spacy
    import textstat
    import sklearn
    print(json.dumps({"status": "ok", "python_version": sys.version}))
except ImportError as e:
    print(json.dumps({"status": "error", "missing_package": str(e)}))
`;

      const result = await this.runPythonScript(checkScript, null, true);
      return JSON.parse(result);
    } catch (error) {
      return {
        status: 'error',
        error: 'Python environment check failed: ' + error.message
      };
    }
  }

  /**
   * Analyze submission text using trained models from pi-engine
   */
  async analyzeSubmission(submissionText, submissionType = 'poem') {
    // Start timing
    this.startTiming();
    
    try {
      // Use the actual pi-engine analyze.py script
      const scriptPath = path.join(this.scriptsDir, 'analyze.py');
      
      try {
        await fs.access(scriptPath);
      } catch (error) {
        throw new Error(`Pi-engine analysis script not found at: ${scriptPath}. Please ensure pi-engine models are available.`);
      }

      // Prepare input data for pi-engine script
      const inputData = {
        text: submissionText,
        type: submissionType
      };

      console.log(`🧠 Running pi-engine trained model analysis for ${submissionType}...`);
      
      // Run trained model analysis
      const result = await this.runPythonScript(scriptPath, inputData);
      
      // Parse result from pi-engine
      let analysis;
      try {
        analysis = JSON.parse(result);
      } catch (parseError) {
        throw new Error('Failed to parse pi-engine analysis result: ' + result.substring(0, 200));
      }

      // Handle pi-engine response format
      if (analysis.error) {
        throw new Error(`Pi-engine analysis error: ${analysis.error}`);
      }

      console.log(`✅ Pi-engine analysis completed in ${this.getProcessingTime()}ms`);
      console.log('📊 Analysis result preview:', {
        quality: analysis.quality,
        themes: analysis.themes?.slice(0, 3),
        style: analysis.style,
        plagiarism: analysis.plagiarism,
        has_quality_breakdown: !!analysis.quality_breakdown
      });

      return {
        success: true,
        analysis: this.formatPiEngineResult({...analysis, original_text: submissionText}),
        processing_time: this.getProcessingTime(),
        python_version: await this.getPythonVersion(),
        source: 'pi-engine-trained-models',
        enhanced_format: !!analysis.quality_breakdown
      };

    } catch (error) {
      console.error('❌ Pi-engine analysis error:', error);
      throw new Error(`Trained model analysis failed: ${error.message}`);
    }
  }

  /**
   * Run Python script with input data
   */
  async runPythonScript(scriptPathOrCode, inputData = null, isDirectCode = false) {
    return new Promise((resolve, reject) => {
      const args = isDirectCode ? ['-c', scriptPathOrCode] : [scriptPathOrCode];
      const python = spawn(this.pythonPath, args);
      
      let result = '';
      let error = '';

      // Set timeout
      const timeoutId = setTimeout(() => {
        python.kill('SIGTERM');
        reject(new Error(`Python script timeout after ${this.timeout}ms`));
      }, this.timeout);

      // Handle stdout
      python.stdout.on('data', (data) => {
        result += data.toString();
      });

      // Handle stderr
      python.stderr.on('data', (data) => {
        error += data.toString();
      });

      // Handle process completion
      python.on('close', (code) => {
        clearTimeout(timeoutId);
        
        if (code !== 0) {
          reject(new Error(`Python script failed with code ${code}: ${error}`));
        } else {
          resolve(result);
        }
      });

      // Handle process errors
      python.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to start Python process: ${err.message}`));
      });

      // Send input data if provided
      if (inputData && !isDirectCode) {
        try {
          python.stdin.write(JSON.stringify(inputData));
          python.stdin.end();
        } catch (writeError) {
          reject(new Error(`Failed to write input to Python script: ${writeError.message}`));
        }
      }
    });
  }

  /**
   * Format pi-engine analysis result for API response with enhanced quality breakdown
   */
  formatPiEngineResult(rawAnalysis) {
    // Calculate additional metrics from the text if not provided
    const text = rawAnalysis.original_text || '';
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const sentences = text.split(/[.!?]+/).filter(sentence => sentence.trim().length > 0);
    const uniqueWords = new Set(words.map(word => word.toLowerCase()));
    
    // Calculate confidence based on model usage and analysis quality
    let confidence = rawAnalysis.confidence || 85; // Use pi-engine confidence or default
    if (!rawAnalysis.using_ml_models) confidence = 65; // Lower for fallback methods
    if (rawAnalysis.error) confidence = 30; // Much lower if there were errors
    
    const result = {
      quality: Math.round((rawAnalysis.quality || 0) * 10) / 10, // Keep 0-10 scale as requested
      style: rawAnalysis.style || 'Contemporary',
      themes: Array.isArray(rawAnalysis.themes) ? rawAnalysis.themes : ['General'],
      plagiarism: Math.round(rawAnalysis.plagiarism || 0), // Remove duplicate plagiarism_score
      confidence: confidence,
      description: rawAnalysis.notes || 'Analysis completed using trained models.',
      readability: {
        score: this.calculateReadabilityScore(text),
        level: this.getReadabilityLevel(this.calculateReadabilityScore(text))
      },
      sentiment: this.analyzeSentiment(text),
      word_count: rawAnalysis.word_count || words.length,
      reading_time: rawAnalysis.reading_time || Math.ceil(words.length / 200) || 1,
      technical_metrics: {
        sentence_count: rawAnalysis.sentence_count || sentences.length,
        avg_sentence_length: sentences.length > 0 ? Math.round(words.length / sentences.length * 10) / 10 : null,
        vocabulary_richness: words.length > 0 ? Math.round((uniqueWords.size / words.length) * 100) / 100 : null
      }
    };
    
    // Add enhanced quality breakdown if available
    if (rawAnalysis.quality_breakdown && typeof rawAnalysis.quality_breakdown === 'object') {
      result.quality_breakdown = {
        imagery: rawAnalysis.quality_breakdown.Imagery || 5.0,
        sensory_details: rawAnalysis.quality_breakdown.Sensory_Details || 5.0,
        cohesiveness: rawAnalysis.quality_breakdown.Cohesiveness || 5.0,
        rich_language: rawAnalysis.quality_breakdown.Rich_Language || 5.0,
        format_structure: rawAnalysis.quality_breakdown.Format_Structure || 5.0,
        emotional_resonance: rawAnalysis.quality_breakdown.Emotional_Resonance || 5.0,
        originality: rawAnalysis.quality_breakdown.Originality || 5.0,
        rhythm: rawAnalysis.quality_breakdown.Rhythm || 5.0,
        layers_of_meaning: rawAnalysis.quality_breakdown.Layers_of_Meaning || 5.0,
        memorable_lines: rawAnalysis.quality_breakdown.Memorable_Lines || 5.0
      };
      
      // Add overall breakdown score
      const breakdown_values = Object.values(result.quality_breakdown);
      result.quality_breakdown.overall_average = Math.round(
        breakdown_values.reduce((sum, val) => sum + val, 0) / breakdown_values.length * 10
      ) / 10;
    }
    
    return result;
  }

  /**
   * Calculate readability score (Flesch Reading Ease approximation)
   */
  calculateReadabilityScore(text) {
    if (!text || text.trim().length === 0) return null;
    
    const words = text.split(/\s+/).filter(word => word.length > 0);
    const sentences = text.split(/[.!?]+/).filter(sentence => sentence.trim().length > 0);
    
    if (words.length === 0 || sentences.length === 0) return null;
    
    // Simple syllable counting
    const syllables = words.reduce((count, word) => {
      return count + this.countSyllables(word);
    }, 0);
    
    const avgWordsPerSentence = words.length / sentences.length;
    const avgSyllablesPerWord = syllables / words.length;
    
    // Flesch Reading Ease formula
    const score = 206.835 - (1.015 * avgWordsPerSentence) - (84.6 * avgSyllablesPerWord);
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * Simple syllable counting
   */
  countSyllables(word) {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    
    const vowels = 'aeiouy';
    let syllableCount = 0;
    let previousWasVowel = false;
    
    for (let i = 0; i < word.length; i++) {
      const isVowel = vowels.includes(word[i]);
      if (isVowel && !previousWasVowel) {
        syllableCount++;
      }
      previousWasVowel = isVowel;
    }
    
    // Adjust for silent e
    if (word.endsWith('e') && syllableCount > 1) {
      syllableCount--;
    }
    
    return Math.max(1, syllableCount);
  }

  /**
   * Get readability level from score
   */
  getReadabilityLevel(score) {
    if (score === null) return null;
    if (score >= 90) return 'Very Easy';
    if (score >= 80) return 'Easy';
    if (score >= 70) return 'Fairly Easy';
    if (score >= 60) return 'Standard';
    if (score >= 50) return 'Fairly Difficult';
    if (score >= 30) return 'Difficult';
    return 'Very Difficult';
  }

  /**
   * Basic sentiment analysis
   */
  analyzeSentiment(text) {
    if (!text || text.trim().length === 0) return null;
    
    const positiveWords = ['love', 'joy', 'hope', 'happy', 'beautiful', 'wonderful', 'amazing', 'brilliant', 'fantastic', 'great', 'excellent', 'perfect', 'sweet', 'gentle', 'warm', 'bright', 'smile', 'laugh', 'peace', 'calm'];
    const negativeWords = ['sad', 'pain', 'hurt', 'grief', 'sorrow', 'terrible', 'awful', 'horrible', 'bad', 'worst', 'hate', 'angry', 'fear', 'dark', 'death', 'cry', 'tear', 'lonely', 'empty', 'broken'];
    
    const words = text.toLowerCase().split(/\s+/);
    let positiveCount = 0;
    let negativeCount = 0;
    
    words.forEach(word => {
      if (positiveWords.some(pos => word.includes(pos))) positiveCount++;
      if (negativeWords.some(neg => word.includes(neg))) negativeCount++;
    });
    
    const totalSentimentWords = positiveCount + negativeCount;
    if (totalSentimentWords === 0) return 'neutral';
    
    const positiveRatio = positiveCount / totalSentimentWords;
    if (positiveRatio > 0.6) return 'positive';
    if (positiveRatio < 0.4) return 'negative';
    return 'neutral';
  }

  /**
   * Get Python version for debugging
   */
  async getPythonVersion() {
    try {
      const result = await this.runPythonScript('import sys; print(sys.version)', null, true);
      return result.trim().split(' ')[0];
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get processing time with actual measurement
   */
  getProcessingTime() {
    if (this.analysisStartTime) {
      return Date.now() - this.analysisStartTime;
    }
    return null;
  }

  /**
   * Start timing analysis process
   */
  startTiming() {
    this.analysisStartTime = Date.now();
  }

  /**
   * Check if Python service is available
   */
  async isServiceAvailable() {
    try {
      const result = await this.verifyPythonEnvironment();
      return result.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Install required Python packages (admin utility)
   */
  async installPythonDependencies() {
    try {
      const packages = [
        'nltk>=3.8',
        'spacy>=3.4',
        'textstat>=0.7',
        'scikit-learn>=1.1',
        'transformers>=4.20',
        'torch>=1.12'
      ];

      const installCommand = `pip install ${packages.join(' ')}`;
      const result = await this.runPythonScript(`import subprocess; subprocess.run("${installCommand}".split())`, null, true);
      
      return {
        success: true,
        message: 'Python dependencies installation initiated',
        details: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = AnalysisService;