const mongoose = require('mongoose');
const Submission = require('./models/Submission');
const Content = require('./models/Content');
require('dotenv').config();

async function fixSubmissionContent() {
  try {
    await mongoose.connect(process.env.ATLAS_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB');

    // Get all published submissions to check their content status
    const submissions = await Submission.find({ 
      status: 'published'
    });
    
    console.log('All published submissions:');
    for (const sub of submissions) {
      console.log(`- ${sub.title}: contentIds = ${sub.contentIds ? sub.contentIds.length : 'undefined'}`);
    }

    // Get submissions that have no content
    const submissionsWithoutContent = submissions.filter(sub => 
      !sub.contentIds || sub.contentIds.length === 0
    );

    console.log(`Found ${submissionsWithoutContent.length} submissions without content`);

    for (const submission of submissionsWithoutContent) {
      console.log(`Fixing submission: ${submission.title}`);
      
      // Create sample content based on submission type
      let sampleContent = [];
      
      if (submission.submissionType === 'poem') {
        sampleContent = [{
          title: submission.title,
          body: `In the quiet moments before the world awakens,
when the first light touches the horizon
and shadows dance with possibility,
I find myself reaching for words
that capture the essence of dawn.

The whispers of morning carry secrets—
of dreams that dissolve like mist,
of hopes that rise with the sun,
of moments suspended between
night's embrace and day's promise.

Each ray of light tells a story,
each bird's song holds a prayer,
each breath of cool air
reminds us that we are alive,
that we are here, that we matter.

In these sacred seconds,
before the world demands our attention,
we remember who we are
beneath all the noise,
beneath all the fear.

We are the children of light,
the keepers of wonder,
the writers of our own stories—
one whisper at a time,
one dawn at a time.`,
          type: 'poem',
          tags: submission.tags || ['poetry', 'dawn', 'inspiration']
        }];
      } else if (submission.submissionType === 'article') {
        sampleContent = [{
          title: submission.title,
          body: `The landscape of modern work has undergone a seismic shift. What began as a temporary response to global circumstances has evolved into a fundamental reimagining of how, where, and why we work.

Remote work isn't just about location independence—it's about reconsidering the very nature of productivity, collaboration, and professional fulfillment. When we remove the physical constraints of the traditional office, we're forced to confront deeper questions about what constitutes meaningful work.

The traditional 9-to-5 paradigm was built around industrial-age thinking: standardized processes, centralized control, and the belief that presence equals productivity. But knowledge work operates differently. It's about creativity, problem-solving, and generating value through ideas rather than time served.

In this new landscape, we're discovering that autonomy breeds responsibility. When people have control over their schedule and environment, they often become more engaged, not less. The key is shifting from measuring hours to measuring outcomes.

However, this transition isn't without challenges. Digital communication, while efficient, can lack the nuance of face-to-face interaction. Building company culture remotely requires intentional effort. And the boundaries between work and life can blur in ways that aren't always healthy.

The future of work isn't about choosing between remote and in-office—it's about creating flexible systems that honor both human needs and business objectives. It's about building trust, measuring results, and recognizing that the best work often happens when people have the freedom to do it their way.

This philosophical shift challenges us to reconsider not just where we work, but how we define success, productivity, and professional fulfillment in an increasingly connected yet physically distributed world.`,
          type: 'article',
          tags: submission.tags || ['remote work', 'productivity', 'philosophy', 'future of work']
        }];
      } else if (submission.submissionType === 'cinema_essay') {
        sampleContent = [{
          title: submission.title,
          body: `Cinema has always been a mirror, but in recent years, that mirror has begun to crack and refract in fascinating ways. The traditional male gaze—that pervasive lens through which women have been objectified and diminished on screen—is being systematically dismantled by a new generation of filmmakers.

This subversion isn't merely about putting women behind the camera, though representation matters immensely. It's about fundamentally restructuring how stories are told, whose perspectives are centered, and what kinds of narratives are deemed worthy of our attention.

Consider the evolution from the classic Hollywood heroine—often defined by her relationship to male characters—to contemporary protagonists who exist as complete beings with their own agency, desires, and complex inner lives. This shift represents more than character development; it's a philosophical reorientation of storytelling itself.

The jubilee in question isn't just a celebration—it's a reclamation. Filmmakers are taking back the narrative space that was long dominated by a singular perspective and filling it with multiple voices, experiences, and ways of seeing the world.

Visual language itself is being rewritten. The way cameras move, where they linger, what they choose to reveal or conceal—all of these technical decisions carry ideological weight. When we change who's behind the camera, we inevitably change what the camera sees and how it sees it.

This transformation extends beyond gender to encompass race, class, sexuality, and other dimensions of identity that have been marginalized in mainstream cinema. The result is a richer, more complex cinematic landscape that better reflects the diversity of human experience.

The old guard may resist, but the movement is irreversible. Audiences hungry for authentic stories are driving demand for films that challenge rather than reinforce outdated power structures. The jubilee isn't coming—it's already here.`,
          type: 'cinema_essay',
          tags: submission.tags || ['cinema', 'film analysis', 'gender', 'representation']
        }];
      } else if (submission.submissionType === 'prose') {
        sampleContent = [{
          title: submission.title,
          body: `There is something revolutionary about choosing to move slowly in a world obsessed with speed.

I discovered this truth on a Tuesday morning when my coffee maker broke. Instead of rushing to replace it, I found myself standing in my kitchen, really looking at it for the first time in years. The morning light filtered through the window in a way I'd never noticed, casting geometric shadows across the worn wooden counter.

This wasn't mindfulness in the commodified sense—the kind sold in apps and workshops. This was something simpler and more radical: the act of allowing time to expand rather than compress.

The modern world operates on the principle of acceleration. Faster internet, quicker commutes, immediate gratification. We measure success by how much we can accomplish, how efficiently we can optimize our days, how seamlessly we can multitask our way through existence.

But what if the answer isn't doing more things faster? What if it's doing fewer things with more attention?

I spent that morning making coffee by hand—boiling water, grinding beans, waiting for the perfect temperature. Each step required presence. There was no scrolling through emails, no mental rehearsal of the day's agenda. Just the ritual of transformation: bean to liquid, waiting to awakening.

The coffee tasted different. Not better or worse, but more itself—if that makes sense. I could taste the particular soil it came from, the specific rainfall of its harvest season. When you slow down enough, details emerge that speed obscures.

This isn't about productivity hacks or life optimization. It's about remembering that time isn't just a resource to be consumed—it's the medium through which we experience being alive.

The art of slow living isn't passive. It's an active resistance to a culture that profits from our hurry, our anxiety, our constant sense that we're falling behind some invisible deadline.

When you move slowly enough, you remember that you're already where you need to be.`,
          type: 'prose',
          tags: submission.tags || ['slow living', 'mindfulness', 'modern life', 'reflection']
        }];
      }

      // Create content documents
      const contentDocs = await Content.create(
        sampleContent.map(content => ({
          ...content,
          userId: submission.userId
        }))
      );

      // Update submission with content IDs
      submission.contentIds = contentDocs.map(c => c._id);
      
      // Update reading time and excerpt if needed
      if (!submission.readingTime) {
        const totalWords = contentDocs.reduce((sum, content) => sum + (content.wordCount || 0), 0);
        submission.readingTime = Math.ceil(totalWords / 200); // Average reading speed
      }
      
      if (!submission.excerpt) {
        submission.excerpt = sampleContent[0].body.substring(0, 150) + '...';
      }

      await submission.save();
      console.log(`✅ Fixed ${submission.title}`);
    }

    console.log('Content fix completed!');
    process.exit(0);
  } catch (error) {
    console.error('Error fixing content:', error);
    process.exit(1);
  }
}

fixSubmissionContent();