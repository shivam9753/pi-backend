const express = require('express');
const multer = require('multer');
const WritingProgram = require('../models/WritingProgram');
const { authenticateUser, requireReviewer, requireAdmin } = require('../middleware/auth');
const { validateObjectId, validatePagination } = require('../middleware/validation');

// Import ImageService for S3/local storage handling
const { ImageService } = require('../config/imageService');

const router = express.Router();

// Use memory storage for multer since we'll handle storage through ImageService
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit for program images
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed!'), false);
    }
  }
});

// ========================================
// PUBLIC ENDPOINTS
// ========================================

// GET /api/writing-programs - Get active writing programs (Public)
router.get('/', validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const programs = await WritingProgram.getActivePrograms({
      limit: parseInt(limit),
      skip: (page - 1) * limit
    });
    
    const total = await WritingProgram.countDocuments({
      status: 'active',
      isPublic: true,
      applicationDeadline: { $gt: new Date() }
    });
    
    res.json({
      programs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching writing programs:', error);
    res.status(500).json({ message: 'Error fetching writing programs', error: error.message });
  }
});

// GET /api/writing-programs/:slug - Get writing program by slug (Public)
router.get('/:slug', async (req, res) => {
  try {
    const program = await WritingProgram.findBySlug(req.params.slug);
    
    if (!program) {
      return res.status(404).json({ message: 'Writing program not found' });
    }
    
    res.json({ program });
  } catch (error) {
    console.error('Error fetching writing program:', error);
    res.status(500).json({ message: 'Error fetching writing program', error: error.message });
  }
});

// ========================================
// ADMIN/REVIEWER ENDPOINTS
// ========================================

// GET /api/writing-programs/admin/all - Get all programs for admin (Admin/Reviewer only)
router.get('/admin/all', authenticateUser, requireReviewer, validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'all', createdBy } = req.query;
    const skip = (page - 1) * limit;
    
    let query = {};
    if (status !== 'all') {
      query.status = status;
    }
    if (createdBy) {
      query.createdBy = createdBy;
    }
    
    const programs = await WritingProgram.find(query)
      .populate('createdBy', 'username name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await WritingProgram.countDocuments(query);
    
    res.json({
      programs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching admin programs:', error);
    res.status(500).json({ message: 'Error fetching programs', error: error.message });
  }
});

// GET /api/writing-programs/admin/:id - Get program details for admin (Admin/Reviewer only)
router.get('/admin/:id', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const program = await WritingProgram.findById(req.params.id)
      .populate('createdBy', 'username name email');
    
    if (!program) {
      return res.status(404).json({ message: 'Writing program not found' });
    }
    
    res.json({ program });
  } catch (error) {
    console.error('Error fetching program details:', error);
    res.status(500).json({ message: 'Error fetching program details', error: error.message });
  }
});

// POST /api/writing-programs - Create new writing program (Admin/Reviewer only)
router.post('/', authenticateUser, requireReviewer, async (req, res) => {
  try {
    const {
      title,
      description,
      criteria,
      applicationDeadline,
      maxApplications,
      isPublic = true
    } = req.body;
    
    // Validation
    if (!title || !description || !applicationDeadline) {
      return res.status(400).json({ 
        message: 'Title, description, and application deadline are required' 
      });
    }
    
    if (new Date(applicationDeadline) <= new Date()) {
      return res.status(400).json({ 
        message: 'Application deadline must be in the future' 
      });
    }
    
    // Create program
    const programData = {
      title,
      description,
      criteria: criteria || {
        questions: [],
        requiresWritingSamples: false,
        minWritingSamples: 1,
        maxWritingSamples: 3,
        maxWordCount: 2000
      },
      applicationDeadline: new Date(applicationDeadline),
      maxApplications: maxApplications || 50,
      isPublic,
      createdBy: req.user._id,
      status: 'draft'
    };
    
    const program = await WritingProgram.create(programData);
    
    res.status(201).json({
      message: 'Writing program created successfully',
      program
    });
  } catch (error) {
    console.error('Program creation error:', error);
    res.status(500).json({ message: 'Error creating writing program', error: error.message });
  }
});

// PUT /api/writing-programs/:id - Update writing program (Admin/Reviewer only)
router.put('/:id', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const program = await WritingProgram.findById(req.params.id);
    
    if (!program) {
      return res.status(404).json({ message: 'Writing program not found' });
    }
    
    // Check permissions - only creator or admin can edit
    if (program.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the program creator or admin can edit this program' });
    }
    
    const {
      title,
      description,
      criteria,
      applicationDeadline,
      maxApplications,
      status,
      isPublic
    } = req.body;
    
    // Update fields
    if (title) program.title = title;
    if (description) program.description = description;
    if (criteria) program.criteria = criteria;
    if (applicationDeadline) {
      const newDeadline = new Date(applicationDeadline);
      if (newDeadline <= new Date()) {
        return res.status(400).json({ 
          message: 'Application deadline must be in the future' 
        });
      }
      program.applicationDeadline = newDeadline;
    }
    if (maxApplications) program.maxApplications = maxApplications;
    if (status) program.status = status;
    if (typeof isPublic !== 'undefined') program.isPublic = isPublic;
    
    // Regenerate slug if title changed
    if (title) {
      program.generateSlug();
    }
    
    await program.save();
    
    res.json({
      message: 'Writing program updated successfully',
      program
    });
  } catch (error) {
    console.error('Program update error:', error);
    res.status(500).json({ message: 'Error updating writing program', error: error.message });
  }
});

// POST /api/writing-programs/:id/upload-image - Upload program image
router.post('/:id/upload-image', authenticateUser, requireReviewer, validateObjectId('id'), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }
    
    const program = await WritingProgram.findById(req.params.id);
    if (!program) {
      return res.status(404).json({ message: 'Writing program not found' });
    }
    
    // Check permissions
    if (program.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the program creator or admin can upload images' });
    }
    
    // Upload image using ImageService
    const result = await ImageService.uploadImage(req.file, 'programs');
    
    // Delete old image if exists
    if (program.imageUrl) {
      try {
        await ImageService.deleteImage(program.imageUrl);
      } catch (deleteError) {
        console.warn('Failed to delete old program image:', deleteError);
      }
    }
    
    // Update program with new image URL
    program.imageUrl = result.url;
    await program.save();
    
    res.json({
      message: 'Program image uploaded successfully',
      imageUrl: result.url
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ message: 'Error uploading image', error: error.message });
  }
});

// DELETE /api/writing-programs/:id - Delete writing program (Admin only)
router.delete('/:id', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const program = await WritingProgram.findById(req.params.id);
    
    if (!program) {
      return res.status(404).json({ message: 'Writing program not found' });
    }
    
    // Check if program has applications
    const Submission = require('../models/Submission');
    const applicationCount = await Submission.countDocuments({
      submissionType: 'writing_program_application',
      'metadata.programId': req.params.id
    });
    
    if (applicationCount > 0) {
      return res.status(400).json({ 
        message: `Cannot delete program with ${applicationCount} existing applications. Archive it instead.` 
      });
    }
    
    // Delete associated image
    if (program.imageUrl) {
      try {
        await ImageService.deleteImage(program.imageUrl);
      } catch (deleteError) {
        console.warn('Failed to delete program image:', deleteError);
      }
    }
    
    await WritingProgram.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Writing program deleted successfully' });
  } catch (error) {
    console.error('Program deletion error:', error);
    res.status(500).json({ message: 'Error deleting writing program', error: error.message });
  }
});

// PATCH /api/writing-programs/:id/status - Update program status (Admin/Reviewer only)
router.patch('/:id/status', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['draft', 'active', 'closed', 'archived'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status value' });
    }
    
    const program = await WritingProgram.findById(req.params.id);
    if (!program) {
      return res.status(404).json({ message: 'Writing program not found' });
    }
    
    // Check permissions
    if (program.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the program creator or admin can change status' });
    }
    
    program.status = status;
    await program.save();
    
    res.json({
      message: `Program status updated to ${status}`,
      program: {
        _id: program._id,
        title: program.title,
        status: program.status
      }
    });
  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({ message: 'Error updating program status', error: error.message });
  }
});

// GET /api/writing-programs/:id/applications - Get applications for a program (Admin/Reviewer only)
router.get('/:id/applications', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'all' } = req.query;
    const skip = (page - 1) * limit;
    
    const program = await WritingProgram.findById(req.params.id);
    if (!program) {
      return res.status(404).json({ message: 'Writing program not found' });
    }
    
    const Submission = require('../models/Submission');
    
    let query = {
      submissionType: 'writing_program_application',
      'metadata.programId': req.params.id
    };
    
    if (status !== 'all') {
      query.status = status;
    }
    
    const applications = await Submission.find(query)
      .populate('userId', 'username name email')
      .populate('reviewedBy', 'username name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Submission.countDocuments(query);
    
    res.json({
      program: {
        _id: program._id,
        title: program.title,
        status: program.status
      },
      applications,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching program applications:', error);
    res.status(500).json({ message: 'Error fetching applications', error: error.message });
  }
});

module.exports = router;