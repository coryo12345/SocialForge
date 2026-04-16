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

EMOTIONAL_REGISTERS = [
    "exhausted", "smug", "genuinely confused", "low-key furious",
    "surprisingly vulnerable", "defensive", "overly enthusiastic",
    "resigned", "vindicated", "anxious", "bittersweet", "petty",
    "deadpan", "earnest to a fault", "barely concealing contempt",
]

POST_ANGLES = [
    "through the lens of their job", "as someone who learned this the hard way",
    "as an outsider to this community", "as someone who changed their mind recently",
    "with way too much specific detail", "while clearly leaving out key information",
    "as someone who has done extensive amateur research on this",
    "from a very regional or local perspective",
    "as someone who is slightly out of touch with current norms",
]


def random_user_seeds(n=3):
    chosen_categories = random.sample(USER_CATEGORIES, n)
    return [random.choice(cat) for cat in chosen_categories]

