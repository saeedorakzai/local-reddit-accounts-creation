/**
 * Reddit register — URLs, selectors, DOM timing.
 *
 * DATA only. No functions, no conditionals, no register logic.
 * Selectors are draft values from the Python porting reference and will be
 * refined after live discovery (npm run inspect:reddit). See
 * docs/reference/reddit-flow.md and docs/plan-reddit-register.md.
 *
 * Prefer arrays of single selectors (tried in order for visibility) over one
 * comma-joined CSS OR — the first DOM match of an OR is often a hidden twin.
 */

module.exports = {
    registerUrl: 'https://www.reddit.com/register/',
    homeUrl: 'https://www.reddit.com/',

    selectors: {
        emailInput: {
            field: [
                'faceplate-text-input#register-email input',
                'faceplate-text-input[name="email"] input',
                'input[name="email"]',
                'input[type="email"]',
                '#register-email',
                'input[autocomplete="email"]'
            ],
            submit: [
                'button[type="submit"]',
                'button:has-text("Continue")',
                'button:has-text("Next")',
                'faceplate-tracker[noun="register"] button'
            ]
        },

        otpInput: {
            field: [
                'faceplate-text-input[name="code"] input',
                'input[name="code"]',
                'input[autocomplete="one-time-code"]',
                'input[inputmode="numeric"]',
                'faceplate-text-input[name="code"] input',
                '#otp'
            ],
            submit: '#email-verification-submit',
            resend: '#auth-email-verify-otp-resend-cta'
        },

        usernameInput: {
            field: [
                'faceplate-text-input#register-username input',
                'faceplate-text-input[name="username"] input',
                'input[name="username"]',
                'input[autocomplete="username"]',
                '#regUsername'
            ]
        },

        passwordInput: {
            field: [
                'faceplate-text-input#register-password input',
                'faceplate-text-input[name="password"] input',
                'input[name="password"]',
                'input[type="password"]',
                'input[autocomplete="new-password"]',
                '#regPassword'
            ]
        },

        submitRegister: {
            button: [
                'button:has-text("Continue")',
                'button:has-text("Sign Up")',
                'button:has-text("Create")',
                'button:has-text("Create account")',
                'button[type="submit"]'
            ],
            suggestUsername: 'button:has-text("Suggest username")'
        },

        // "About you" — birthday. Order is Day → Month → Year (DD/MM/YYYY)
        // from references/onboarding-flow/all.html (ob-age-selection).
        aboutYou: {
            day: [
                'faceplate-text-input[name="day"] input',
                'input[name="day"]'
            ],
            month: [
                'faceplate-text-input[name="month"] input',
                'input[name="month"]'
            ],
            year: [
                'faceplate-text-input[name="year"] input',
                'input[name="year"]'
            ],
            submit: '#age-collect-submit-btn',
            // Second modal after Continue.
            confirm: [
                'button:has-text("Yes, Confirm")',
                'button[aria-label*="Yes, confirm my birthday" i]',
                'button[type="submit"]:has-text("Confirm")'
            ],
            confirmHeading: ['confirm your birthday']
        },

        // Gender — each option is type=submit (advances immediately).
        // Skip: button[name="skip"] in the modal close slot.
        gender: {
            options: [
                'button[name="genderEnum"][value="FEMALE"]',
                'button[name="genderEnum"][value="MALE"]',
                'button[name="genderEnum"][value="NON_BINARY"]',
                'button[name="genderEnum"][value="OPT_OUT"]'
            ],
            skip: 'button[name="skip"]',
            question: '#gender-selection-question'
        },

        // Choose your interests — from references/onboarding-flow/5-choose-interest.html
        // (auth-flow-modal pagename=parent_interest_picker).
        // How many / which topics: src/features/register/config.js (randomized).
        interests: {
            modal: 'auth-flow-modal[pagename="parent_interest_picker"]',
            topicsRoot: '#parent-topics',
            checkbox: 'input[name="parent-topic-id"]',
            topicContainer: '.topic-container',
            topicIds: [
                'art', 'beauty', 'career', 'entertainment', 'finance', 'food',
                'gaming', 'news', 'sports', 'technology', 'travel', 'wellness'
            ],
            submit: '#parent-interest-picker-submit-button',
            skip: [
                'auth-flow-modal[pagename="parent_interest_picker"] button[name="skip"]',
                'auth-flow-modal[pagename="parent_interest_picker"] button:has-text("Skip")'
            ],
            heading: ['choose your interests']
        },

        // "Personalizing your experience" spinner — wait it out.
        personalizing: {
            text: ['personalizing your experience']
        },

        // Customize your feed — references/onboarding-flow/6-customized-feed.html
        // dump is dialog chrome only (slots empty). Detect by aria-label; pick
        // communities if present, then primary Continue / Skip.
        customizeFeed: {
            dialog: [
                '[role="dialog"][aria-label="Customize your feed"]',
                '[aria-label="Customize your feed"]'
            ],
            heading: ['customize your feed'],
            // Live community chips / follows (inner HTML not in dump — best effort).
            pick: [
                '[role="dialog"][aria-label="Customize your feed"] input[type="checkbox"]',
                '[role="dialog"][aria-label="Customize your feed"] button[aria-pressed]',
                '[aria-label="Customize your feed"] button:has-text("Follow")',
                '[aria-label="Customize your feed"] label'
            ],
            submit: [
                '[role="dialog"][aria-label="Customize your feed"] button[type="submit"]',
                '[role="dialog"][aria-label="Customize your feed"] button:has-text("Continue")',
                '[aria-label="Customize your feed"] [slot="primaryButton"] button',
                'button:has-text("Continue")'
            ],
            skip: [
                '[role="dialog"][aria-label="Customize your feed"] button[name="skip"]',
                '[role="dialog"][aria-label="Customize your feed"] button:has-text("Skip")',
                'button[name="skip"]'
            ]
        },

        // Leftover onboarding modals (notifications, etc.).
        interstitial: {
            skip: [
                'button[name="skip"]',
                'button:has-text("Skip")',
                'button:has-text("Skip for now")',
                'button:has-text("Not now")',
                'button:has-text("No thanks")',
                'button:has-text("Maybe later")'
            ],
            continue: [
                'button:has-text("Continue")',
                'button:has-text("Next")',
                'button:has-text("Finish")',
                'button:has-text("Done")',
                'button:has-text("Submit")',
                'button:has-text("Get started")'
            ]
        },

        // Link-verify path — Reddit says check email / click the link.
        verifyEmailPrompt: {
            text: [
                'check your email',
                'verify your email',
                'confirmation email',
                'click the link',
                'sent you an email'
            ]
        },

        loggedIn: {
            evidence: [
                '[data-testid="user-dropdown-button"]',
                '[data-testid="profile-menu"]',
                'button[aria-label*="Expand user menu" i]',
                'button[aria-label*="Open profile menu" i]',
                '#expand-user-drawer-button',
                '[data-testid="user-menu"]'
            ]
        },

        captcha: {
            frame: [
                'iframe[src*="captcha"]',
                'iframe[src*="recaptcha"]',
                'iframe[src*="hcaptcha"]',
                '#challenge-form',
                '[data-testid="captcha"]'
            ],
            text: [
                'verify you\'re human',
                'are you a robot',
                'verify youre human',
                'prove your humanity',
                'prove you are human'
            ]
        },

        emailTaken: {
            text: [
                'already been taken',
                'already taken',
                'already registered',
                'email is in use',
                'email already exists'
            ]
        }
    },

    timing: {
        typeDelay: { min: 50, max: 130 },
        betweenFields: { min: 700, max: 1800 },
        beforeSubmit: { min: 500, max: 1400 },
        navigationTimeoutMs: 60000
    }
};
