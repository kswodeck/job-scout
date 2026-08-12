// Kris Swodeck — master resume/cover-letter source of truth.
// Verbatim from his build_resume.js MASTER (verified against the live master PDF).
// The generator may ONLY reorder/select skills from here and rephrase THESE bullets
// — never invent experience. This file is the anti-fabrication anchor.

const RESUME_PHONE = process.env.RESUME_PHONE || "";
const RESUME_EMAIL = process.env.RESUME_EMAIL || "";

const MASTER = {
  name: "Kris Swodeck",
  title: "Front-End Web Developer / Software Engineer",
  tagline: "JavaScript  •  TypeScript  •  Front-End Development & Engineering  •  Responsive, Accessible Web Apps",
  summary: "Front-End Web Developer / Software Engineer with 7+ years building and testing performant, accessible production web applications across the full software development lifecycle. Specialized in JavaScript, TypeScript, HTML5, CSS3, and the Vue / Nuxt.js ecosystem, with a solid Node.js foundation. Combines hands-on development with a quality-driven engineering mindset and daily AI-assisted development workflows to ship reliable, well-tested, maintainable code. A Business Administration background adds a product mindset — weighing user, customer, and business impact to ensure each feature solves the right problem. B.S. in Computer Science with a Business Administration minor.",
  // Contact details are NOT stored in this repo — it is public, and a committed
  // phone number/email gets harvested by scrapers. They come from the
  // RESUME_PHONE / RESUME_EMAIL env vars (GitHub Actions secrets in CI, a local
  // shell export when running by hand). Unset = the generated DOCX simply omits
  // that line, so a draft built without them is visibly incomplete rather than
  // wrong. The public profile links stay in the clear: they are already public.
  contact: {
    location: "Dallas–Fort Worth, TX",
    phone: RESUME_PHONE, phoneUrl: RESUME_PHONE ? `tel:+1${RESUME_PHONE.replace(/\D/g, "")}` : "",
    email: RESUME_EMAIL, emailUrl: RESUME_EMAIL ? `mailto:${RESUME_EMAIL}` : "",
    linkedin: "linkedin.com/in/kristoffer-swodeck", linkedinUrl: "https://linkedin.com/in/kristoffer-swodeck",
    github: "github.com/kswodeck", githubUrl: "https://github.com/kswodeck",
    site: "kswodeck.swodecksitesolutions.com", siteUrl: "https://kswodeck.swodecksitesolutions.com",
  },
  // The full skill pool. The generator reorders/selects from these lines only.
  skills: [
    ["Languages", "JavaScript, TypeScript, HTML5, CSS3, SQL"],
    ["Frameworks & Libraries", "Vue, Nuxt.js, Node.js, Express.js, JSON/XHTML, SASS, React, Next.js, Tailwind"],
    ["Testing & QA", "Test Automation, Selenium, Mocha, Chai, BrowserStack, Vitest, Playwright"],
    ["Databases", "SQL, MongoDB, PostgreSQL"],
    ["Tools & Platforms", "Git, Bitbucket, Jira, Visual Studio Code, Cursor, Vite, Netlify, Claude Code, GitHub Actions & Copilot, Vercel"],
    ["Concepts & Methodologies", "AI-Assisted Development, Responsive Web Design, REST APIs, CI/CD, UX/UI Design, Agile / Scrum, SDLC, WCAG Accessibility, SEO, Web Analytics"],
  ],
  experience: [
    {
      org: "MIND Education", loc: " — Irvine, CA", dates: "Jan 2019 – Jun 2026",
      roles: [
        {
          title: "Web Developer", dates: "Jul 2021 – Jun 2026",
          bullets: [
            "Built and maintained a customer-facing EdTech platform in Vue, Nuxt.js, and Node.js that enabled PK-12 administrators and educators to monitor and manage students across an internet-based math curriculum.",
            "Translated product requirements into responsive, accessible UI with HTML, CSS, and JavaScript, delivering a consistent experience across devices and screen sizes.",
            "Developed and shipped customer-facing features in Vue and Nuxt.js, improving the usability and overall experience of the platform.",
            "Partnered with QA to triage and resolve defects before release, contributing to stable deployments and a seamless user experience.",
            "Continuously evaluated emerging front-end technologies and industry best practices, integrating improvements to enhance development workflows and platform reliability.",
          ],
        },
        {
          title: "Quality Engineer", dates: "Jan 2019 – Jul 2021",
          bullets: [
            "Supported the SDLC of learning-based math games using Agile / Scrum QA methodologies.",
            "Built and maintained automated UI test suites in Selenium with JavaScript (Node.js) to catch regressions before release.",
            "Integrated Mocha, Chai, and BrowserStack into the test pipeline to enable cross-browser automated testing.",
            "Isolated, reproduced, and tracked defects through resolution, verifying fixes against product requirements.",
            "Authored detailed, reproducible bug reports in Jira (with Git, Bitbucket, and Confluence) to speed developer turnaround.",
            "Wrote and ran SQL queries to validate data accuracy across game software products before release.",
          ],
        },
      ],
    },
    {
      org: "Internet Brands", loc: " — El Segundo, CA", dates: "Jul 2018 – Jan 2019",
      roles: [
        {
          title: "Quality Assurance Intern", dates: "",
          bullets: [
            "Developed and executed automated test scripts that streamlined regression testing and reduced manual test effort.",
            "Conducted risk assessments and tracked quality metrics across web products to flag reliability issues before launch.",
            "Reproduced customer-reported issues and partnered with developers to verify patches, improving diagnosis accuracy and fix turnaround.",
          ],
        },
      ],
    },
    {
      org: "PTI Thermal Solutions", loc: " — Santa Fe Springs, CA", dates: "Oct 2017 – Jan 2019",
      roles: [
        {
          title: "Web Designer", dates: "",
          bullets: [
            "Designed and maintained the company website in WordPress using HTML, CSS, and JavaScript.",
            "Implemented SEO/SEM and social media strategies to grow the company's organic traffic and digital presence.",
            "Applied UX/UI design principles to improve navigation, accessibility, and visual hierarchy; analyzed web-traffic data in Google Analytics to inform design decisions and measure impact.",
          ],
        },
      ],
    },
  ],
  projects: [
    {
      name: "Swodeck Site Solutions — Personal Portfolio",
      linkText: "kswodeck.swodecksitesolutions.com", linkUrl: "https://kswodeck.swodecksitesolutions.com",
      dates: "Apr 2024 – Present",
      bullets: [
        "Designed and built a personal portfolio rendered as four fully independent front-end applications — Vanilla JS/TS, Angular, React, and Vue — each natively implemented and served at its own URL, a live demonstration of cross-framework proficiency.",
        "Engineered a custom Node.js build pipeline that compiles all four framework builds in parallel via child processes into one deployable output, paired with a custom Vite dev-middleware plugin that serves live content for instant hot reload.",
      ],
    },
    {
      name: "CalcCrunch",
      linkText: "calccrunch.com", linkUrl: "https://calccrunch.com",
      dates: "Nov 2025",
      bullets: [
        "Designed, built, and solo-launched CalcCrunch.com — a fully static Astro + TypeScript (strict) site of 100+ free, registration-free calculators built for performance and SEO.",
        "Engineered an autonomous GitHub Actions + Claude (Anthropic API) pipeline that researches topics, generates content, validates, and pushes to production on Netlify unattended.",
      ],
    },
    {
      name: "FantasyFire",
      linkText: "fantasyfire.app", linkUrl: "https://fantasyfire.app",
      dates: "Jan 2026 – Present",
      bullets: [
        "Designed and built FantasyFire, a sports player-props research tool that turns free, public game logs into hit rates, defense-vs-position matchups, and sample-size confidence, built with Next.js (App Router), React, and TypeScript on a Tailwind CSS UI.",
        "Architected a read-only, SEO-driven app backed by PostgreSQL via Prisma, with a scheduled GitHub Actions worker that ingests upstream stats into the database while the web app reads through a versioned, Zod-validated JSON API.",
      ],
    },
  ],
  education: [
    ["Biola University", " — B.S., Computer Science; Minor, Business Administration", "Jan 2015 – Dec 2018"],
  ],
};

// Flat list of every bullet the generator is allowed to rephrase (for validation).
MASTER.allBullets = [
  ...MASTER.experience.flatMap(co => co.roles.flatMap(r => r.bullets)),
  ...MASTER.projects.flatMap(p => p.bullets),
];

module.exports = { MASTER };
