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

POST_FORMATS = [
    "a rant", "a confession", "a humble-brag", "a request for advice",
    "a hot take", "an update to a previous situation", "a milestone announcement",
    "a question they already know the answer to", "venting without wanting advice",
    "sharing something they found", "a detailed how-to", "a wronged customer complaint",
    "a long personal story with a mundane conclusion", "defending an unpopular position",
    "asking if they're the asshole", "celebrating a small personal win",
]

NARRATIVE_POST_FORMATS = [
    "a first-person story with a clear setup, escalating conflict, and satisfying payoff",
    "a revenge story told chronologically with specific details and a triumphant ending",
    "a story where you detail exactly what the other person did and precisely how you responded",
    "a blow-by-blow account of an incident that ended in your favor",
    "a story that starts with 'so this happened' and escalates into chaos",
    "a story recounting a situation where you kept your cool and let the consequences unfold",
    "a confession of something you did in retaliation that you have zero regrets about",
    "an update post where you describe the original offense and then how you got back at them",
    "a story told with escalating detail where the ending is proportionally satisfying",
    "a tale of a workplace, neighbor, or stranger conflict that you won decisively",
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


def random_user_seeds(n=3):
    chosen_categories = random.sample(USER_CATEGORIES, n)
    return [random.choice(cat) for cat in chosen_categories]


def random_ideation_hints(is_narrative=False):
    """Return (format_hint, register_hint, angle_hint) for Stage 1 ideation."""
    formats = NARRATIVE_POST_FORMATS if is_narrative else POST_FORMATS
    registers = NARRATIVE_EMOTIONAL_REGISTERS if is_narrative else EMOTIONAL_REGISTERS
    angles = NARRATIVE_POST_ANGLES if is_narrative else POST_ANGLES
    return random.choice(formats), random.choice(registers), random.choice(angles)

