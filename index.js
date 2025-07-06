// app.js

const express = require('express');
const cors = require('cors');
const { ObjectId } = require('mongodb');
const { connectDB, getDB } = require('./db/db');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors());

// Connect to MongoDB
connectDB().catch(error => {
  console.error('Error connecting to database:', error);
  process.exit(1); // Exit process on connection failure
});

// Middleware to ensure db is connected before continuing
app.use((req, res, next) => {
  try {
    getDB(); // Ensure db connection is available
    next();
  } catch (error) {
    res.status(500).json({ error: 'Database not connected!' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const db = getDB();
    const usersCollection = db.collection('users');

    const users = await usersCollection.find({}).toArray();

    res.status(200).json({ users });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});


app.post('/api/auth/google-user', async (req, res) => {
  const { email, name } = req.body;

  if (!email || !name) {
    return res.status(400).json({ message: 'Email and name are required' });
  }

  try {
    const db = getDB();
    const usersCollection = db.collection('users');

    const existingUser = await usersCollection.findOne({ email });

    if (existingUser) {
      return res.status(200).json({ message: 'User already exists', user: existingUser });
    }

    const newUser = {
      email,
      username: name,
      password: 'GOOGLE_AUTH', // or null if your schema allows
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await usersCollection.insertOne(newUser);

    return res.status(201).json({ message: 'User created', user: newUser });
  } catch (err) {
    console.error('Error inserting user:', err);
    return res.status(500).json({ message: 'Server error', error: err });
  }
});


// Define routes
app.get('/api/content', async (req, res) => {
  try {
    const db = getDB();
    const content = await db.collection('content').find({}).toArray();
    res.json(content);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/submissions', async (req, res) => {
  const { type } = req.query;

  // Optional match stage for filtering by submission_type
  const matchStage = type ? { $match: { submissionType: type } } : null;

  const pipeline = [
    ...(matchStage ? [matchStage] : []),
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'userInfo'
      }
    },
    {
      $unwind: '$userInfo'
    },
    {
      $project: {
        _id: 1,
        title: 1,
        status: 1,
        contentIds: 1,
        submissionType: 1,
        createdAt: 1,
        updatedAt: 1,
        username: '$userInfo.username'
      }
    }
  ];

  try {
    const db = getDB();
    const submissions = await db.collection('submissions').aggregate(pipeline).toArray();
    res.json(submissions);
  } catch (error) {
    console.error("Error fetching submissions:", error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/api/submissions/:id/contents', async (req, res) => {
  const submissionId = req.params.id;

  try {
    const db = getDB();
    const submission = await db.collection('submissions').findOne({ _id: new ObjectId(submissionId) });

    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Get content documents for contentIds
    const contents = await db
      .collection('content')
      .find({ _id: { $in: submission.contentIds.map(id => new ObjectId(id)) } })
      .toArray();

    res.json({
      ...submission,
      contents,
    });
  } catch (err) {
    console.error('❌ Error fetching submission:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post('/api/submissions', async (req, res) => {
  const db = getDB();

  const {
    userId,
    title,
    description,
    submissionType,
    contents
  } = req.body;

  if (!userId || !title || !submissionType || !Array.isArray(contents) || contents.length === 0) {
    return res.status(400).json({ error: 'Missing required fields or empty contents array' });
  }

  try {
    const userObjectId = new ObjectId(userId);

    // Validate user exists
    const userExists = await db.collection('users').findOne({ _id: userObjectId });
    if (!userExists) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Insert content documents
    const contentDocs = contents.map((content) => ({
      ...content,
      userId: userObjectId,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    const insertContentResult = await db.collection('content').insertMany(contentDocs);
    const contentIds = Object.values(insertContentResult.insertedIds);

    // Prepare submission doc
    const submissionDoc = {
      userId: userObjectId,
      title,
      description,
      contentIds,
      submissionType,
      status: 'pending_review',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const submissionResult = await db.collection('submissions').insertOne(submissionDoc);

    res.status(201).json({
      message: 'Submission created successfully',
      submissionId: submissionResult.insertedId
    });

  } catch (err) {
    console.error('❌ Submission error:', err);
    if (err.code === 121) {
      res.status(400).json({
        error: 'Submission failed schema validation',
        details: err.errInfo
      });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});


// PATCH /api/submissions/:id/status
app.patch('/api/submissions/:id/status', async (req, res) => {
  const db = getDB();
  const submissions = db.collection('submissions');
  const { id } = req.params;
  const { status, reviewerId, reviewNotes } = req.body;

  const validStatuses = ['accepted', 'rejected'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status value. Must be accepted or rejected.' });
  }

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid submission ID' });
  }

  const updateFields = {
    status,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  };

  if (reviewerId && ObjectId.isValid(reviewerId)) {
    updateFields.reviewerId = new ObjectId(reviewerId);
  }

  if (reviewNotes) {
    updateFields.reviewNotes = reviewNotes;
  }

  try {
    const result = await submissions.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateFields },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.json({
      message: `Submission ${status}`,
      submission: result.value,
    });
  } catch (err) {
    console.error('Error updating submission status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});




// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
