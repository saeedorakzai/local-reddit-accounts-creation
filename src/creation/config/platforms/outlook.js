/**
 * Outlook / Microsoft sign-in — URLs, selectors, DOM timing.
 *
 * This file is DATA. No functions, no conditionals, no login logic — that lives in
 * src/platforms/outlook/screens.js. Selectors are grouped by the screen id that
 * uses them, so a Microsoft redesign is a config edit.
 *
 * Prefer Microsoft's stable hooks — the name attributes (loginfmt, passwd, otc) and
 * the #idSIButton9 / #idBtn_Back button ids — over visible text. Text matchers are
 * locale-sensitive and fail silently on a non-English profile; a sudden spike in
 * `unknown` outcomes is a locale problem first.
 */

module.exports = {
    inboxUrl: 'https://outlook.live.com/mail/0/',
    loginUrl: 'https://login.live.com/',
    logoutUrl: 'https://login.live.com/logout.srf',

    /** A URL matching any of these means we are still inside the sign-in flow. */
    loginUrlPatterns: [
        'login.live.com',
        'login.microsoftonline.com',
        'account.live.com',
        'signup.live.com'
    ],

    /**
     * A logged-out hit on the mailbox URL bounces to Microsoft 365 marketing
     * rather than straight to login. Landing here proves "not signed in", so the
     * inbox check can stop waiting immediately instead of timing out.
     */
    signedOutUrlPatterns: [
        '/microsoft-365/outlook',
        'microsoft.com/en-'
    ],

    selectors: {
        inbox: {
            // URL alone is not enough — Outlook briefly shows the mail URL while
            // still redirecting to login. Require rendered mailbox chrome.
            evidence: [
                'div[role="main"][aria-label]',
                '[aria-label="Message list"]',
                'div[data-app-section="MessageList"]',
                'button[aria-label*="New mail" i]',
                '#owaLeftColumn'
            ]
        },

        // Account / Me chrome — used by src/platforms/outlook/identity.js to
        // scrape the signed-in address for Reddit register (not for login).
        // Half-width windows often hide the email until the Me control opens;
        // last resort widens the window and reads the left sidebar.
        identity: {
            menuButton: [
                '#owa-me-control-container button',
                'button[data-tid="me-control-mini-avatar"]',
                '#owa-me-control-container button.qeGMt',
                'button#mectrl_main_trigger',
                'button#O365_MainLink_Me',
                '#meInitialsButton',
                '#mectrl_headerPicture',
                'button[aria-label*="Account manager" i]',
                'button[aria-label*="Account" i]',
                'button[id*="meControl" i]',
                'button[aria-label*="Signed in" i]'
            ].join(', '),
            // After Me menu opens — secondary line is the email.
            emailField: [
                '#mectrl_currentAccount_secondary',
                '#mectrl_currentAccount_primary',
                '[id*="currentAccount" i]',
                'a#mectrl_viewAccount[href*="username="]',
                'a#mectrl_currentAccount_picture[href*="username="]',
                '[data-testid*="account" i][title*="@"]',
                'div[role="menu"] [title*="@"]',
                'div[role="dialog"] [title*="@"]'
            ].join(', '),
            menuReady: [
                '#mectrl_currentAccount_secondary',
                '#mectrl_main_body.expanded',
                '#mectrl_main_body',
                'div.mectrl_dropdownbody.expanded',
                'div[role="dialog"][aria-label*="Account manager" i]'
            ].join(', '),
            menuOpenWaitMs: 12000,
            // Last-resort layout: widen so folder pane / chrome shows the address.
            wideViewport: { width: 1440, height: 900 },
            sidebarRoot: [
                '#owaLeftColumn',
                '[data-app-section="FolderPane"]',
                '[aria-label="Folder pane"]',
                '[aria-label*="Folder pane" i]',
                'div[role="navigation"]',
                '#LeftRail'
            ].join(', '),
            sidebarEmail: [
                '#owaLeftColumn [title*="@"]',
                '[data-app-section="FolderPane"] [title*="@"]',
                '#owaLeftColumn [aria-label*="@"]',
                'button[aria-label*="@outlook.com" i]',
                'button[aria-label*="@hotmail.com" i]',
                'button[aria-label*="@live.com" i]',
                'span[title*="@outlook.com" i]',
                'div[title*="@outlook.com" i]',
                '[data-app-section="FolderPane"] [aria-label*="@"]'
            ].join(', ')
        },

        // Cookie / third-party privacy modal on Outlook mail (Accept / Reject).
        // Can cover the Me avatar and block identity scrape — Accept and continue.
        outlookPrivacyConsent: {
            text: [
                'third parties process data',
                'accept all button',
                'advanced settings button',
                'by clicking the accept all'
            ],
            accept: [
                '.ms-Dialog-actions button:has-text("Accept")',
                '.ms-Modal-scrollableContent button:has-text("Accept")',
                'button.ms-Button--primary:has-text("Accept")',
                'button:has-text("Accept all")',
                'button:has-text("Accept")'
            ],
            marker: [
                '.ms-Modal-scrollableContent',
                '.ms-Dialog-actions',
                'img[alt*="Microsoft logo" i]'
            ]
        },

        // Reddit verification mail in the Outlook inbox (same-browser OTP).
        // Used by src/platforms/outlook/redditOtp.js — not part of the login table.
        redditOtp: {
            searchBox: 'input[aria-label*="Search" i], #topSearchInput, input[placeholder*="Search" i]',
            searchQuery: 'from:reddit',
            messageRow: [
                '[aria-label="Message list"] [role="option"]',
                'div[data-app-section="MessageList"] [role="option"]',
                '[role="listbox"] [role="option"]',
                'div[role="option"]'
            ],
            readingPane: [
                '[aria-label="Reading Pane"]',
                '[aria-label*="Message body" i]',
                'div[data-app-section="ReadingPane"]',
                '[role="document"]',
                'div[role="main"]'
            ]
        },

        // Microsoft's 2026 redesign dropped the name attributes entirely: the email
        // field is #usernameEntry and the primary action is
        // button[data-testid="primaryButton"]. Legacy hooks are kept as fallbacks
        // because the old UI still appears for some accounts and regions.
        emailInput: {
            field: '#usernameEntry, input[type="email"][name="loginfmt"], #i0116, input[name="loginfmt"]',
            submit: 'button[data-testid="primaryButton"], #idSIButton9, input[type="submit"][value="Next"], button[type="submit"]'
        },

        passwordInput: {
            field: '#passwordEntry, input[type="password"][name="passwd"], #i0118, input[name="passwd"], input[type="password"]',
            submit: 'button[data-testid="primaryButton"], #idSIButton9, input[type="submit"][value="Sign in"], button[type="submit"]'
        },

        staySignedIn: {
            heading: '#kmsiTitle, #idDiv_SAOTCAS_Description',
            marker: '#KmsiCheckboxField, input[name="DontShowAgain"], #kmsiTitle',
            yes: 'button[data-testid="primaryButton"], #idSIButton9, input[type="submit"][value="Yes"]',
            no: 'button[data-testid="secondaryButton"], #idBtn_Back, input[type="button"][value="No"]'
        },

        wrongPassword: {
            error: '#passwordError, #i0118Error, div[role="alert"]:has-text("password is incorrect")',
            text: ['account or password is incorrect', 'password is incorrect']
        },

        noAccount: {
            error: '#usernameError, #i0116Error',
            text: [
                "couldn't find an account",
                'we couldn’t find an account',
                'that microsoft account doesn’t exist'
            ]
        },

        accountLocked: {
            urlPatterns: ['account.live.com/recover', 'account.live.com/Abuse', '/identity/confirm'],
            text: [
                'your account has been locked',
                'account has been temporarily suspended',
                "we've detected unusual activity",
                'help us protect you'
            ]
        },

        captcha: {
            frame: 'iframe[src*="arkoselabs"], iframe[src*="funcaptcha"], #enforcementFrame',
            marker: '#arkose, [data-testid="challenge"]',
            text: ['solve the puzzle', 'help us fight spam', 'prove you are human']
        },

        verifyIdentity: {
            marker: '#idDiv_SAOTCS_Proofs, #ProofChoice, #idDiv_SAOTCS_Title',
            text: ['verify your identity', 'help us protect your account', 'protect your account']
        },

        twoFactor: {
            field: 'input[name="otc"], #idTxtBx_OTC_Password',
            marker: '#idDiv_SAOTCC_Title, #idRemoteNGC_DisplaySign',
            text: ['enter the code', 'approve the sign-in request', 'open your authenticator app']
        },

        pickAccount: {
            marker: '#tilesHolder, div[data-testid="accountTile"]',
            tile: 'div[data-testid="accountTile"], #tilesHolder .table',
            useAnother: '#otherTile, #otherTileText, div:has-text("Use another account")'
        },

        passkeyNag: {
            marker: '#iShowSkip, #idDiv_SAOTCAS_Title:has-text("password")',
            text: ['break free from passwords', 'sign in faster', 'go passwordless'],
            skip: '#iShowSkip, #iCancel, button:has-text("Skip for now"), a:has-text("Skip for now")'
        },

        // After sign-in Microsoft sometimes lands on the account portal rather than
        // the mailbox. Recognised by URL; the handler redirects to the inbox.
        accountPortal: {
            urlPatterns: ['account.microsoft.com', 'account.live.com/landing']
        },

        // Post-login "Set up a passkey" enrollment (navigator.credentials.create).
        // Distinct from the sign-in bridge below — decline it with Cancel.
        passkeyEnroll: {
            urlPatterns: ['/fido/create', '/fido/enroll'],
            text: ['setting up your passkey', 'set up a passkey', 'create a passkey'],
            skip: '#idBtn_Back, input[value="Cancel"], button:has-text("Cancel"), button:has-text("Skip for now"), #iCancel'
        },

        // Passwordless-preferred accounts auto-launch a passkey/FIDO prompt after
        // the email step. There is no OS authenticator here, so we leave it for the
        // sign-in-options screen and choose the password path instead. The prompt
        // fails on its own ("Something went wrong") and offers "Other ways to sign
        // in"; take that link if present, otherwise back out.
        // Use Playwright's exact-text engine (text="…") not :has-text(): the options
        // are spans, and :has-text also matches the wrapper span containing the
        // whole layout, so a click lands on the wrapper's centre and misses.
        passkeyBridge: {
            urlPatterns: ['/bridge/fido', '/bridge/'],
            text: ['signing in with your passkey', 'opening a security window', 'use your passkey'],
            otherWays: [
                'text="Other ways to sign in"',
                'text="Sign in another way"'
            ],
            back: '#back-button, button[data-testid="leftArrowIcon"], button[aria-label="Back"]'
        },

        // "Sign in another way" — the fork where the password option lives.
        signInOptions: {
            marker: '#loginOptions, [data-testid="signinOptions"]',
            text: ['sign in another way', 'other ways to sign in', 'sign-in options'],
            usePassword: [
                'text="Use your password"',
                '[data-testid="proofOption"]:has-text("password")'
            ]
        },

        protectAccount: {
            marker: '#iSelectProofTitle, #idDiv_SAOTCS_Title',
            text: ['help us protect your account', 'add security info', 'keep your account secure'],
            skip: '#iCancel, #idBtn_Back, button:has-text("Skip for now"), a:has-text("Skip for now")'
        },

        termsUpdate: {
            text: ["we've updated our terms", 'updated our privacy', 'review the terms'],
            accept: '#idSIButton9, button:has-text("Next"), button:has-text("Accept")'
        },

        // Post-password consent page. Its body renders inside an iframe, so it is
        // recognised by URL rather than text. Continue with whatever affirmative
        // button it shows.
        privacyNotice: {
            urlPatterns: ['privacynotice.account.microsoft.com'],
            continue: [
                '#idSIButton9',
                'button[data-testid="primaryButton"]',
                'input[type="submit"]',
                'button:has-text("Next")',
                'button:has-text("Continue")',
                'button:has-text("Yes")',
                'button:has-text("Accept")',
                'button:has-text("Got it")',
                'button:has-text("OK")'
            ]
        }
    },

    timing: {
        typeDelay: { min: 60, max: 140 },
        betweenFields: { min: 700, max: 1800 },
        beforeSubmit: { min: 500, max: 1400 },
        settle: { min: 1200, max: 2600 },
        navigationTimeoutMs: 45000,

        // The mailbox is a heavy SPA — it can show a blank shell for several
        // seconds before either rendering or bouncing to login. One short settle
        // would misread a live session as logged out.
        inboxLoadTimeoutMs: 40000,

        // How long to poll the mailbox for THIS account's email before deciding
        // the signed-in identity is wrong (or trusting inbox signals if none yet).
        identityConfirmTimeoutMs: 35000,

        // Sign-in blanks the document between steps. How long to wait for the next
        // screen to render before treating an empty page as genuinely unreadable.
        screenSettleTimeoutMs: 25000
    }
};
