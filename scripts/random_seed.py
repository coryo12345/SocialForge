import random

USER_SEED_WORDS = [
    # Life stages & family situations
    "divorced", "widowed", "remarried", "estranged", "childless",
    "homeschooling", "fostering", "sandwich-generation", "empty-nester", "eloping",

    # Geography & place identity
    "appalachian", "landlocked", "rust-belt", "bayou", "high-desert",
    "island", "border-town", "coal-country", "flyover", "tundra",

    # Economic context
    "working-class", "underwater", "inheritor", "unbanked", "bootstrapping",
    "union", "strike", "layoff", "overtime", "subsistence",

    # Work & schedule
    "night-shift", "seasonal", "gig-worker", "commuter", "remote",
    "self-employed", "apprentice", "volunteer", "underemployed", "temp",

    # Health & body
    "chronic-pain", "sober", "recovering", "deaf", "insomnia",
    "transplant", "caregiver", "hypochondriac", "vegan", "immunocompromised",

    # Belief & identity
    "devout", "lapsed", "convert", "agnostic", "superstitious",
    "multilingual", "first-generation", "expatriate", "stateless", "naturalized",

    # Personality & disposition
    "contrarian", "obsessive", "frugal", "impulsive", "paranoid",
    "nostalgic", "competitive", "secretive", "fatalistic", "idealistic",

    # Life events & circumstances
    "bankrupt", "incarcerated", "exonerated", "whistleblower", "survivor",
    "transplanted", "displaced", "estranged", "drafted", "blacklisted",

    # Hobbies & subcultures (unusual)
    "doomsday-prepper", "train-spotter", "amateur-taxidermist", "competitive-eater", "storm-chaser",
    "metal-detectorist", "amateur-radio", "dumpster-diver", "urban-explorer", "beekeeping",

    # Politics & civic life
    "disillusioned", "activist", "conspiracy-adjacent", "recall-voter", "single-issue",
    "door-knocker", "jury-duty", "whistleblower", "zoning-obsessed", "third-party",
]

USER_CATEGORIES = [
    USER_SEED_WORDS[0:10],   # life stages
    USER_SEED_WORDS[10:20],  # geography
    USER_SEED_WORDS[20:30],  # economic
    USER_SEED_WORDS[30:40],  # work
    USER_SEED_WORDS[40:50],  # health
    USER_SEED_WORDS[50:60],  # belief/identity
    USER_SEED_WORDS[60:70],  # personality
    USER_SEED_WORDS[70:80],  # life events
    USER_SEED_WORDS[80:90],  # hobbies
    USER_SEED_WORDS[90:100], # politics
]

# Each entry is (format description, length hint: "short" | "medium" | "long")
POST_FORMATS = [
    ("a rant", "medium"),
    ("a confession", "medium"),
    ("a humble-brag", "short"),
    ("a request for advice", "medium"),
    ("a hot take", "short"),
    ("an update to a previous situation", "medium"),
    ("a milestone announcement", "short"),
    ("a question they already know the answer to", "short"),
    ("venting without wanting advice", "medium"),
    ("sharing something they found", "short"),
    ("a detailed how-to", "long"),
    ("a wronged customer complaint", "medium"),
    ("a long personal story with a mundane conclusion", "long"),
    ("defending an unpopular position", "medium"),
    ("asking if they're the asshole", "long"),
    ("celebrating a small personal win", "short"),
]

NARRATIVE_POST_FORMATS = [
    ("a first-person story with a clear setup, escalating conflict, and satisfying payoff", "long"),
    ("a revenge story told chronologically with specific details and a triumphant ending", "long"),
    ("a story where you detail exactly what the other person did and precisely how you responded", "long"),
    ("a blow-by-blow account of an incident that ended in your favor", "long"),
    ("a story that starts with 'so this happened' and escalates into chaos", "long"),
    ("a story recounting a situation where you kept your cool and let the consequences unfold", "long"),
    ("a confession of something you did in retaliation that you have zero regrets about", "medium"),
    ("an update post where you describe the original offense and then how you got back at them", "long"),
    ("a story told with escalating detail where the ending is proportionally satisfying", "long"),
    ("a tale of a workplace, neighbor, or stranger conflict that you won decisively", "long"),
]

EMOTIONAL_REGISTERS = [
    "exhausted", "smug", "genuinely confused", "low-key furious",
    "surprisingly vulnerable", "defensive", "overly enthusiastic",
    "resigned", "vindicated", "anxious", "bittersweet", "petty",
    "deadpan", "earnest to a fault", "barely concealing contempt",
]

NARRATIVE_EMOTIONAL_REGISTERS = [
    "smugly satisfied", "vindicated and a little proud", "still fuming but triumphant",
    "amused in retrospect", "gleefully petty", "calmly devastating",
    "can't believe it worked", "zero regrets", "lowkey villain energy",
    "telling this story for the tenth time because it's that good",
]

POST_ANGLES = [
    "through the lens of their job", "as someone who learned this the hard way",
    "as an outsider to this community", "as someone who changed their mind recently",
    "with way too much specific detail", "while clearly leaving out key information",
    "as someone who has done extensive amateur research on this",
    "from a very regional or local perspective",
    "as someone who is slightly out of touch with current norms",
]

NARRATIVE_POST_ANGLES = [
    "with specific names changed but every other detail intact",
    "with way too much satisfying detail about the other person's reaction",
    "starting with what made them snap and ending with the beautiful consequences",
    "while making it clear they would absolutely do it again",
    "with the setup taking twice as long as the payoff, which is still worth it",
    "as someone who waited patiently for the perfect moment",
    "while casually mentioning it happened years ago but they still think about it fondly",
    "noting that witnesses or bystanders were delighted by what unfolded",
]

# Opening lines to seed natural Reddit voice — injected into Stage 3
REDDIT_OPENERS = [
    "So this just happened and I'm still processing it.",
    "I need to vent. Bear with me.",
    "Long post, sorry in advance.",
    "I don't even know where to start with this.",
    "I've been sitting on this for a week and I need to share it.",
    "Not sure if this is the right place but here goes.",
    "This is going to sound unbelievable but I swear it's real.",
    "I'm still kind of shaking as I type this.",
    "Throwaway because people IRL know my main account.",
    "Context: this has been building for months.",
    "I need the internet to tell me I'm not crazy.",
    "So here's the thing.",
    "You guys are not going to believe what just happened.",
    "I've been wanting to post about this for a while.",
    "Quick background before I get into it.",
    "This is embarrassing to admit but here we go.",
    "I told my partner about this and they said I should post it here.",
    "I feel like I'm taking crazy pills.",
    "Ok so.",
    "Genuine question:",
    "Update on a situation I posted about a while back.",
    "I've been going back and forth on whether to post this.",
    "So apparently I'm the bad guy now.",
    "I don't usually post here but this has been eating at me.",
    "My coworker thinks I'm wrong about this. Am I?",
]

# Voice rules randomly sampled and injected into Stage 3
REDDIT_VOICE_PHRASES = [
    "Use contractions naturally (I'm, it's, they've, wouldn't). Never write 'I am' when 'I'm' works.",
    "Use 'tbh', 'ngl', 'idk', 'imo', or 'lol' at least once where it fits naturally.",
    "Write in short paragraphs. Hit enter between thoughts. No walls of text.",
    "Sentence fragments are fine. So is starting a sentence with 'And' or 'But'.",
    "Write how you'd talk to a friend, not how you'd write an email to your boss.",
    "Trail off at the end if you're still processing — you don't need a neat conclusion.",
    "Use em-dashes — like this — for asides or mid-thought interruptions.",
    "Use 'like', 'literally', 'honestly', and 'basically' the way real people do.",
    "It's okay to repeat yourself slightly for emphasis. People do that when they're wound up.",
    "If the moment is funny, be funny. If it's infuriating, let that show — don't flatten the emotion.",
    "Mild swearing is fine if it fits the emotion — 'what the hell', 'honestly screw that', 'are you kidding me'.",
    "Don't explain your own emotions too clinically. Show them through what you said or did.",
]

# Anti-patterns to ban — randomly sampled and injected into Stage 3
ANTI_ROBOT_RULES = [
    "Do NOT write like a news article or formal essay.",
    "Do NOT use ## headers or bullet point lists in the post body.",
    "Do NOT start with 'As a...' or 'In today's world...' or any generic preamble.",
    "Do NOT write a tidy concluding paragraph that wraps everything up neatly if the situation is still unresolved.",
    "Do NOT explain what the post is about before diving in. Just start writing.",
    "Do NOT use the phrase 'I wanted to share' or 'I feel compelled to'.",
    "Do NOT write in perfect complete sentences if the person is upset — let it be a little messy.",
    "Do NOT summarize the post at the end. If you've said it, don't say it again.",
]


def random_user_seeds(n=3):
    chosen_categories = random.sample(USER_CATEGORIES, n)
    return [random.choice(cat) for cat in chosen_categories]


def random_ideation_hints(is_narrative=False):
    """Return (format_hint, length_hint, register_hint, angle_hint) for Stage 1 ideation."""
    formats = NARRATIVE_POST_FORMATS if is_narrative else POST_FORMATS
    registers = NARRATIVE_EMOTIONAL_REGISTERS if is_narrative else EMOTIONAL_REGISTERS
    angles = NARRATIVE_POST_ANGLES if is_narrative else POST_ANGLES
    format_hint, length_hint = random.choice(formats)
    return format_hint, length_hint, random.choice(registers), random.choice(angles)


def random_reddit_voice():
    """Return (opener, voice_rules, anti_robot) to inject into Stage 3."""
    opener = random.choice(REDDIT_OPENERS)
    voice_rules = random.sample(REDDIT_VOICE_PHRASES, 3)
    anti_robot = random.sample(ANTI_ROBOT_RULES, 3)
    return opener, voice_rules, anti_robot
