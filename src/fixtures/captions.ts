// Prepared caption variations used by the simulated generator.
// This is proposed demonstration copy, not verified company advertising: no prices, accreditors,
// guarantees, testimonials, instructors or procedural safety/medical instructions.

import type { CaptionLength, Tone, TopicKey } from '../domain/types';

export interface TopicBank {
  label: string;
  general: string[];
  linkedin: string[];
  x: string[];
  /** Extra sentences appended for the Long length. */
  extended: string[];
  hashtagSets: string[][];
  storyHeadlines: string[];
  youtubeShortTitle: string;
  youtubeVideoTitle: string;
}

export const TOPICS: Record<TopicKey, TopicBank> = {
  training: {
    label: 'Training awareness',
    general: [
      'Thinking about your next step in lifeguard training? Explore the options with Lifeguard-Pro.org and bring your questions to the team. Preparation begins with a conversation.',
      'A clear next step starts with the right questions. Discover training options with Lifeguard-Pro.org and plan your learning journey.',
      'Ready to make time for training? Learn more about Lifeguard-Pro.org and ask the team which options fit your goals.',
    ],
    linkedin: [
      'For aquatic teams, development starts with a clear understanding of training goals. Lifeguard-Pro.org is a place to begin that conversation. What questions would help your team plan its next learning step?',
      'Training plans work best when they begin with shared goals. Lifeguard-Pro.org can be the starting point for that discussion. Which learning priorities is your aquatic team weighing this season?',
      'Professional development in aquatics benefits from a clear plan. Start by mapping your training goals, then explore the options available through Lifeguard-Pro.org.',
    ],
    x: [
      'Planning your next training step? Explore Lifeguard-Pro.org and bring your questions to the team.',
      'Your next training step starts with a question. Ask the Lifeguard-Pro.org team.',
      'Making time for training this season? Explore your options with Lifeguard-Pro.org.',
    ],
    extended: [
      'Write down what you want to learn, note any scheduling needs, and use those notes to start the conversation.',
      'A short list of goals and questions can make it easier to compare options and choose a next step.',
      'Whether you are starting out or planning ahead, a clear conversation is a useful first step.',
    ],
    hashtagSets: [
      ['#LifeguardTraining', '#WaterSafety', '#LifeguardPro'],
      ['#LifeguardPro', '#TrainingGoals', '#Aquatics'],
      ['#WaterSafety', '#PoolLife', '#LearnSomethingNew'],
    ],
    storyHeadlines: ['Make your next step count', 'Build confidence through training', 'Explore your training options'],
    youtubeShortTitle: 'Plan your next training step',
    youtubeVideoTitle: 'A new learning goal with Lifeguard-Pro.org',
  },
  preparedness: {
    label: 'Preparedness',
    general: [
      'Preparation deserves a place on the calendar. Set aside time to review your training goals and the questions you want to ask before your next step.',
      'A little planning creates a clearer path forward. Start with your goals, collect your questions, and make room for learning.',
      'What does your next learning goal look like? Take a moment to plan, then explore your options with Lifeguard-Pro.org.',
    ],
    linkedin: [
      'Team planning is easier when learning goals are on the calendar early. Which professional development priorities is your aquatic team setting aside time for?',
      'Preparation is a team habit. Set aside time to review learning goals together, then explore options with Lifeguard-Pro.org.',
      'Professional development starts with planning. Collect your team’s training questions and use them to shape the next conversation.',
    ],
    x: [
      'Preparation deserves a place on the calendar. What will you plan for next?',
      'Goals first, questions second, learning next. Plan your step with Lifeguard-Pro.org.',
      'Take a moment to plan your next learning goal, then explore your options.',
    ],
    extended: [
      'Keep a simple list of goals and dates so planning conversations stay focused.',
      'Revisiting your plan regularly makes it easier to spot the next useful step.',
      'Small planning habits can make a busy season feel more manageable.',
    ],
    hashtagSets: [
      ['#Preparation', '#WaterSafety', '#LifeguardTraining'],
      ['#PlanAhead', '#Aquatics', '#LifeguardPro'],
      ['#TrainingGoals', '#Preparation', '#PoolSeason'],
    ],
    storyHeadlines: ['Preparation starts before poolside', 'Ready to learn. Ready to prepare.', 'Take time to prepare'],
    youtubeShortTitle: 'Make time to prepare',
    youtubeVideoTitle: 'Planning your next learning goal with Lifeguard-Pro.org',
  },
  team: {
    label: 'Team development',
    general: [
      'Strong teams make time to learn. Start a conversation about your team’s training goals and the next steps you want to explore.',
      'Learning is easier to plan when the team is part of the conversation. What would you like to focus on next?',
      'Bring your training questions together. A shared plan can help your team choose its next learning step.',
    ],
    linkedin: [
      'Aquatic facility managers: how does your team decide what to learn next? A shared conversation about goals is often the most useful starting point.',
      'Team development works best as a shared plan. What learning priorities is your aquatic team discussing this quarter?',
      'For aquatic facility leaders, planning team learning starts with listening. Gather your team’s questions and explore options with Lifeguard-Pro.org.',
    ],
    x: [
      'Strong teams make time to learn. What is your team focusing on next?',
      'Learning together starts with a shared plan. Start the conversation with Lifeguard-Pro.org.',
      'Bring your team’s training questions together and choose the next step.',
    ],
    extended: [
      'Invite everyone to share one question; the answers often shape a better plan.',
      'A short team check-in can turn individual goals into a shared learning plan.',
      'Shared goals help everyone see where they fit in the next step.',
    ],
    hashtagSets: [
      ['#TeamDevelopment', '#Aquatics', '#LifeguardTraining'],
      ['#LearningTogether', '#AquaticTeams', '#LifeguardPro'],
      ['#TeamGoals', '#Aquatics', '#ProfessionalDevelopment'],
    ],
    storyHeadlines: ['Strong teams keep learning', 'Make room for team development', 'Learn together. Prepare together.'],
    youtubeShortTitle: 'Learning together as a team',
    youtubeVideoTitle: 'Team learning goals with Lifeguard-Pro.org',
  },
  questions: {
    label: 'Course questions',
    general: [
      'Not sure where to begin? Write down your questions about training and contact the Lifeguard-Pro.org team to explore your next step.',
      'Every learning journey starts somewhere. Tell us what you would like to know about training options.',
      'Your goals. Your questions. Your next step. Start a conversation with Lifeguard-Pro.org.',
    ],
    linkedin: [
      'Questions are a useful starting point for professional development. What would your team like to know before planning its next training step?',
      'Before choosing a training path, it helps to collect the questions that matter most to your team. Lifeguard-Pro.org is ready for that conversation.',
      'What questions does your aquatic team have about training options? Share them with Lifeguard-Pro.org and start planning the next step.',
    ],
    x: [
      'Not sure where to begin? Bring your training questions to the Lifeguard-Pro.org team.',
      'What would you like to know about training options? Ask Lifeguard-Pro.org.',
      'Your goals. Your questions. Your next step.',
    ],
    extended: [
      'No question is too small when you are planning your next step.',
      'Collecting questions in one place makes the conversation quicker and clearer.',
      'Start with what you already know, then ask about what you would like to learn.',
    ],
    hashtagSets: [
      ['#LifeguardPro', '#TrainingGoals', '#Aquatics'],
      ['#AskUs', '#LifeguardTraining', '#WaterSafety'],
      ['#NextStep', '#Aquatics', '#LifeguardPro'],
    ],
    storyHeadlines: ['Your next step starts with a question', 'What would you like to know?', 'Find the right next step'],
    youtubeShortTitle: 'Bring your training questions',
    youtubeVideoTitle: 'Your training questions with Lifeguard-Pro.org',
  },
};

/** Neutral caption used when Instagram + LinkedIn share one version. */
export const SHARED_IG_LINKEDIN = [
  'Make learning part of your next plan. Explore your training goals, collect your questions, and start a conversation with Lifeguard-Pro.org.',
  'Learning goals are easier to reach with a plan. Gather your questions, set aside time, and talk with Lifeguard-Pro.org about your next step.',
  'Plan the next step in your learning. Note your goals, bring your questions, and explore options with Lifeguard-Pro.org.',
];

/** Templates for custom topics: the user's wording is inserted into a safe sentence. No factual research is implied. */
export const CUSTOM_TEMPLATES = [
  'Thinking about {topic}? Bring your questions to the Lifeguard-Pro.org team and start a conversation about your next step.',
  'Let’s talk about {topic}. Share what you would like to learn and explore your options with Lifeguard-Pro.org.',
  '{Topic} is a great reason to plan ahead. Collect your questions and contact Lifeguard-Pro.org to explore what fits your goals.',
];

export const CUSTOM_HASHTAGS = [
  ['#LifeguardPro', '#Aquatics', '#TrainingGoals'],
  ['#LifeguardPro', '#WaterSafety', '#NextStep'],
  ['#Aquatics', '#LearnSomethingNew', '#LifeguardPro'],
];

export const TONE_STYLE: Record<Tone, { openers: string[]; closers: string[] }> = {
  professional: { openers: [], closers: [] },
  friendly: {
    openers: ['Hi there!', 'Hello, pool people!', 'Good to see you here!'],
    closers: ['We would love to hear from you.', 'Say hello any time.', 'Drop us a note when you are ready.'],
  },
  energetic: {
    openers: ['Let’s go!', 'Big plans ahead!', 'Ready, set, learn!'],
    closers: ['Let’s make it happen!', 'Your next step is waiting!', 'Dive in today!'],
  },
};

export const LENGTH_LABEL: Record<CaptionLength, string> = { short: 'Short', medium: 'Medium', long: 'Long' };

export const DEFAULT_CTAS = ['Explore training options', 'Contact the team'];
