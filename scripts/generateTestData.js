const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

// Import models
const User = require('../models/User');
const Submission = require('../models/Submission');
const Content = require('../models/Content');

// Connect to MongoDB
mongoose.connect(process.env.ATLAS_URL || 'mongodb://localhost:27017/poemsindiadb-dev', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Sample data
const sampleUsers = [
  {
    email: 'author1@example.com',
    username: 'poetryLover23',
    password: 'password123',
    bio: 'A passionate poet from Mumbai who finds inspiration in everyday moments.',
    socialLinks: {
      website: 'https://poetrylover.com',
      twitter: '@poetryLover23'
    }
  },
  {
    email: 'writer2@example.com',
    username: 'storyteller_maya',
    password: 'password123',
    bio: 'Maya is a storyteller who weaves magic through words.',
    socialLinks: {
      instagram: '@storyteller_maya'
    }
  },
  {
    email: 'critic@example.com',
    username: 'cinemacritic',
    password: 'password123',
    bio: 'Film critic and essay writer exploring the depths of cinema.',
    socialLinks: {
      website: 'https://cinemacritic.blog',
      linkedin: 'cinema-critic'
    }
  },
  {
    email: 'admin@example.com',
    username: 'admin_user',
    password: 'admin123',
    role: 'admin',
    bio: 'Platform administrator and poetry enthusiast.'
  },
  {
    email: 'reviewer@example.com',
    username: 'poetry_reviewer',
    password: 'reviewer123',
    role: 'reviewer',
    bio: 'Experienced poetry reviewer with 10+ years in literary criticism.'
  }
];

const samplePoems = [
  {
    title: 'The Silent Dawn',
    body: `In the quiet hours before the world awakes,
When shadows dance with morning light,
I find myself among the lakes
Of memory, serene and bright.

The dew drops hold the secrets
Of yesterday's forgotten dreams,
While birds sing ancient melodies
Along the silver streams.`
  },
  {
    title: 'City Lights',
    body: `Neon signs flicker like fireflies
Against the canvas of the night,
Each window tells a story
Of hopes burning bright.

In this concrete jungle
Where dreams are made and lost,
Every soul searches for meaning
No matter what the cost.`
  },
  {
    title: 'Monsoon Memories',
    body: `The first drops of rain
Kiss the parched earth below,
Awakening forgotten scents
That only the heart can know.

Children dance in puddles
While elders smile and remember
When they too were young
In monsoon's sweet surrender.`
  }
];

const sampleStories = [
  {
    title: 'The Last Train',
    body: `The platform was empty except for an old man sitting on the bench, clutching a worn leather suitcase. He had been waiting for three hours, but the last train of the night was delayed.

"Are you going somewhere special?" I asked, sitting beside him.

He smiled, his eyes distant. "I'm going home," he said. "After forty years, I'm finally going home."

The train's whistle echoed in the distance, and I watched as his face lit up with a joy I had never seen before. Sometimes, the longest journeys are the ones that lead us back to where we started.`
  },
  {
    title: 'The Bookshop on Elm Street',
    body: `Every morning at 8 AM, Mrs. Chen opened her bookshop on Elm Street. The bell above the door chimed its familiar greeting as she arranged the display of novels in the window.

Today was different. A young girl, no more than ten, stood pressing her nose against the glass, staring at a book of fairy tales.

"Would you like to come in?" Mrs. Chen asked, opening the door.

The girl shook her head. "I don't have any money."

Mrs. Chen smiled. "The best stories are free," she said, "when shared with the right person."

That afternoon, the bookshop had its youngest regular customer.`
  }
];

const sampleArticles = [
  {
    title: 'The Digital Age of Poetry',
    body: `In an era dominated by 280-character tweets and Instagram stories, one might wonder if there's still a place for poetry. The answer is a resounding yes, but the landscape has changed dramatically.

Social media platforms have become the new literary salons, where poets share their work with global audiences instantly. Apps like Instagram and TikTok have given rise to "Instapoets" - writers who craft verses specifically for digital consumption.

This democratization of poetry has its critics. Traditional literary scholars argue that the brevity required by social media platforms diminishes the depth and complexity that poetry can achieve. However, supporters contend that these platforms make poetry more accessible to younger generations.

The truth likely lies somewhere in between. While social media poetry may lack the structural complexity of traditional forms, it serves as an entry point for many readers who might never have discovered poetry otherwise.

The challenge for contemporary poets is to find balance - using digital platforms to reach wider audiences while maintaining the artistic integrity that makes poetry a lasting art form.`
  }
];

const sampleQuotes = [
  {
    title: 'On Courage',
    body: `"Courage is not the absence of fear, but action in spite of it. Every morning we wake up and choose: to be paralyzed by our doubts, or to step forward into the unknown with grace."

— Anonymous`
  },
  {
    title: 'On Time',
    body: `"Time is like water flowing through our fingers. We can try to cup it, hold it, save it for later, but it will always find a way to slip away. The secret is not to waste time trying to stop it, but to use it wisely while we have it."

— From "Reflections on Impermanence"`
  }
];

const sampleCinemaEssays = [
  {
    title: 'The Language of Silence in Cinema',
    body: `Cinema is often praised for its dialogue, its music, its visual spectacle. But some of the most powerful moments in film history come from silence - those pregnant pauses that speak louder than words.

Consider the final scene of "Lost in Translation" where Bob whispers something inaudible to Charlotte. Sofia Coppola's decision to keep this moment private between the characters creates an intimacy that no scripted dialogue could achieve.

Similarly, in "2001: A Space Odyssey," Kubrick uses silence to create a sense of the infinite, the unknowable. The vacuum of space becomes a character itself, one that communicates through absence rather than presence.

These directors understand that cinema is not just about what we see and hear, but about what we don't. The spaces between words, the gaps between cuts, the moments of stillness - these are where true cinematic poetry lives.

In our current age of rapid-fire editing and constant noise, perhaps we need more filmmakers willing to embrace the eloquence of silence.`
  }
];

const submissionTypes = ['poem', 'story', 'article', 'quote', 'cinema_essay'];
const sampleContent = {
  poem: samplePoems,
  story: sampleStories,
  article: sampleArticles,
  quote: sampleQuotes,
  cinema_essay: sampleCinemaEssays
};

// Helper functions
function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomDescription() {
  const descriptions = [
    'A heartfelt piece exploring themes of love and loss.',
    'An introspective work that delves into the human condition.',
    'A beautiful reflection on nature and our place within it.',
    'A powerful narrative that challenges conventional thinking.',
    'An emotional journey through memory and time.',
    'A thought-provoking piece about modern society.',
    'A lyrical exploration of identity and belonging.',
    'A moving story about family and relationships.',
    'A contemplative work on the meaning of existence.',
    'An inspiring tale of resilience and hope.'
  ];
  return getRandomElement(descriptions);
}

async function generateTestData() {
  try {
    console.log('Starting test data generation...');

    // Clear existing data
    console.log('Clearing existing data...');
    await User.deleteMany({});
    await Submission.deleteMany({});
    await Content.deleteMany({});

    // Create users
    console.log('Creating users...');
    const users = [];
    for (const userData of sampleUsers) {
      const hashedPassword = await bcrypt.hash(userData.password, 10);
      const user = new User({
        ...userData,
        password: hashedPassword
      });
      await user.save();
      users.push(user);
      console.log(`Created user: ${user.username}`);
    }

    // Create 30 unreviewed submissions
    console.log('Creating 30 unreviewed submissions...');
    const submissions = [];
    
    for (let i = 0; i < 30; i++) {
      const submissionType = getRandomElement(submissionTypes);
      const contentSamples = sampleContent[submissionType];
      const randomUser = getRandomElement(users.filter(u => u.role === 'user'));
      
      // Create content for this submission (1-3 content pieces)
      const numContents = getRandomNumber(1, submissionType === 'poem' ? 3 : 1);
      const contentIds = [];
      
      for (let j = 0; j < numContents; j++) {
        const contentData = getRandomElement(contentSamples);
        const content = new Content({
          userId: randomUser._id,
          title: `${contentData.title}${numContents > 1 ? ` - Part ${j + 1}` : ''}`,
          body: contentData.body,
          type: submissionType,
          tags: ['test-data', submissionType, `user-${randomUser.username}`]
        });
        await content.save();
        contentIds.push(content._id);
      }

      // Create submission
      const submission = new Submission({
        userId: randomUser._id,
        title: contentIds.length > 1 ? 
          `${getRandomElement(contentSamples).title} Collection` : 
          contentIds[0] ? (await Content.findById(contentIds[0])).title : 'Untitled',
        description: generateRandomDescription(),
        contentIds: contentIds,
        submissionType: submissionType,
        status: 'pending_review',
        readingTime: getRandomNumber(1, 5),
        excerpt: generateRandomDescription().substring(0, 150)
      });
      
      await submission.save();
      submissions.push(submission);
      console.log(`Created submission ${i + 1}/30: "${submission.title}" by ${randomUser.username}`);
    }

    console.log('\n=== Test Data Generation Complete ===');
    console.log(`Created ${users.length} users:`);
    users.forEach(user => {
      console.log(`  - ${user.username} (${user.email}) - Role: ${user.role}`);
    });
    
    console.log(`\nCreated ${submissions.length} unreviewed submissions:`);
    const submissionsByType = {};
    submissions.forEach(sub => {
      submissionsByType[sub.submissionType] = (submissionsByType[sub.submissionType] || 0) + 1;
    });
    
    Object.keys(submissionsByType).forEach(type => {
      console.log(`  - ${type}: ${submissionsByType[type]} submissions`);
    });

    console.log('\nLogin credentials for testing:');
    console.log('Regular users:');
    sampleUsers.filter(u => u.role === 'user' || !u.role).forEach(user => {
      console.log(`  - Email: ${user.email}, Password: ${user.password}`);
    });
    console.log('Admin/Reviewer:');
    sampleUsers.filter(u => u.role && u.role !== 'user').forEach(user => {
      console.log(`  - Email: ${user.email}, Password: ${user.password}, Role: ${user.role}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('Error generating test data:', error);
    process.exit(1);
  }
}

// Run the script
generateTestData();