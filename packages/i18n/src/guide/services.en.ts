/** guide.services: strings for the services slice of ADR-0041. */
export const servicesEn = {
  form: {
    destinationSearch: "Search cities and areas",
    destinationHint: "Pick a city from the list. For anywhere else, choose the nearest one and name the place in your note.",
    destinationNoMatch: "No city matches. Choose the nearest one and name the place in your note.",
    featured: "Featured",
    listingsErrorTitle: "We could not load the listings",
    listingsErrorBody: "Check your connection and try again. You can still send a request below.",
  },
  intro: {
    offersTitle: "What you can ask us for",
    stepsTitle: "How it works",
    needTitle: "What you need",
    afterTitle: "After you send",
    afterCommon: "Sending a request is not a booking, and nothing is charged. Our team reads it and contacts you on the phone number you give us.",
    hotels: {
      offers: {
        o1: { t: "City hotels", d: "Tell us the city and the area you prefer." },
        o2: { t: "Apartment hotels", d: "A kitchen and more room for longer stays." },
        o3: { t: "Your preferences", d: "Star rating, room type and meal plan, if they matter to you." },
        o4: { t: "Options in one quote", d: "Our team compares hotels and sends what it found together." },
      },
      steps: {
        s1: { t: "Tell us the basics", d: "Destination, dates, guests and rooms." },
        s2: { t: "Add preferences", d: "Optional: stars, room type, meals and a note." },
        s3: { t: "We compare", d: "Our team looks at hotels that fit and prepares a quote." },
        s4: { t: "You decide", d: "Read the quote and accept it only if you are happy." },
      },
      need: {
        n1: "A destination and your travel dates",
        n2: "The number of guests and rooms",
        n3: "A verified phone number in your account",
      },
      after: "We reply with hotel options and a quote. You choose whether to go ahead.",
    },
    trains: {
      offers: {
        o1: { t: "Train journeys in Iran", d: "Ask about a route between the cities in our list." },
        o2: { t: "Several passengers", d: "Tell us how many people are travelling." },
        o3: { t: "Help with the details", d: "Our team checks the route and the date for you." },
      },
      steps: {
        s1: { t: "Choose your route", d: "Pick where you leave from and where you go." },
        s2: { t: "Pick a date", d: "Choose the day and the number of passengers." },
        s3: { t: "Send the request", d: "Add a note if you have a time or class in mind." },
        s4: { t: "We reply", d: "Our team confirms the route and sends a quote." },
      },
      need: {
        n1: "Your cities and travel date",
        n2: "The number of passengers",
        n3: "A verified phone number in your account",
      },
      after: "Our team confirms whether the route can be arranged and sends you a quote.",
    },
    buses: {
      offers: {
        o1: { t: "Intercity bus journeys", d: "Ask about a route between the cities in our list." },
        o2: { t: "Several passengers", d: "Tell us how many people are travelling." },
        o3: { t: "Help with the details", d: "Our team checks the route and the date for you." },
      },
      steps: {
        s1: { t: "Choose your route", d: "Pick where you leave from and where you go." },
        s2: { t: "Pick a date", d: "Choose the day and the number of passengers." },
        s3: { t: "Send the request", d: "Add a note if you have a time in mind." },
        s4: { t: "We reply", d: "Our team confirms the route and sends a quote." },
      },
      need: {
        n1: "Your cities and travel date",
        n2: "The number of passengers",
        n3: "A verified phone number in your account",
      },
      after: "Our team confirms whether the route can be arranged and sends you a quote.",
    },
    stays: {
      offers: {
        o1: { t: "Villas and holiday homes", d: "Ask about a place on the Caspian coast, in the mountains or elsewhere." },
        o2: { t: "Apartments", d: "Useful for families and groups who want more space." },
        o3: { t: "Any city on the list", d: "Choose a destination, or tell us if yours is not there." },
        o4: { t: "Listings we have checked", d: "Some places are listed by our team as an indication only." },
      },
      steps: {
        s1: { t: "Pick a destination", d: "Browse the cards or search the list." },
        s2: { t: "Choose your dates", d: "Add the number of guests and rooms." },
        s3: { t: "Send the request", d: "Tell us what matters in a note." },
        s4: { t: "We get back to you", d: "Our team looks for places that suit and sends a quote." },
      },
      need: {
        n1: "A destination and your dates",
        n2: "The number of guests and rooms",
        n3: "A verified phone number in your account",
      },
      after: "We look for suitable places and contact you with what we find.",
    },
    insurance: {
      offers: {
        o1: { t: "Travel insurance quote", d: "Tell us where you are going and for how long." },
        o2: { t: "Cover for each traveller", d: "Choose who in your account is travelling." },
        o3: { t: "Plain explanations", d: "Our team explains the options before you decide." },
      },
      steps: {
        s1: { t: "Choose the area", d: "Pick the region you are travelling to." },
        s2: { t: "Set your dates", d: "Add the first and last day of the trip." },
        s3: { t: "Choose travellers", d: "Select the people from your account." },
        s4: { t: "We reply", d: "Our team sends you a quote to read." },
      },
      need: {
        n1: "Your destination region and trip dates",
        n2: "Travellers saved in your account",
        n3: "A verified phone number in your account",
      },
      after: "Our team contacts you with a quote. No policy exists until you accept it.",
    },
    tours: {
      offers: {
        o1: { t: "A call about your trip", d: "Tell us where you would like to go." },
        o2: { t: "Flexible dates", d: "Approximate dates are enough to start." },
        o3: { t: "Groups and families", d: "Say how many people are travelling." },
        o4: { t: "Ideas from our team", d: "We talk through what could suit you." },
      },
      steps: {
        s1: { t: "Tell us your idea", d: "A destination and roughly when." },
        s2: { t: "Say who is travelling", d: "Add the number of travellers." },
        s3: { t: "Choose a time to call", d: "Tell us when it suits you to talk." },
        s4: { t: "We call you", d: "Our team talks through what is possible." },
      },
      need: {
        n1: "A destination and approximate dates",
        n2: "The number of travellers",
        n3: "A good time for us to call",
      },
      after: "Our team calls you at the time you chose. Nothing is sold on this page.",
    },
  },
} as const
