const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const router = express.Router();

router.post('/analyze-poetry', async (req, res) => {
  try {
    const { submissionText, submissionId } = req.body;
    
    // Path to your Python script
    const pythonScript = path.join('C:', 'poetry-analyzer', 'models', 'analyze.py');
    
    const python = spawn('python', [pythonScript]);
    python.stdin.write(JSON.stringify({ text: submissionText }));
    python.stdin.end();
    
    let result = '';
    python.stdout.on('data', (data) => {
      result += data.toString();
    });
    
    python.on('close', () => {
      try {
        const analysis = JSON.parse(result);
        res.json({
          submissionId,
          analysis,
          timestamp: new Date()
        });
      } catch (error) {
        res.status(500).json({ error: 'Failed to parse analysis result' });
      }
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Analysis failed' });
  }
});

module.exports = router;