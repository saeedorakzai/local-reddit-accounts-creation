export { loadConfig, validateConfig, pathsFromConfig } from './config/config.js';
export { Logger, getLogger, setLogger } from './logging/logger.js';
export { FirefoxProfileManager, createProfileManager } from './browser/firefoxProfileManager.js';
export { BrowserManager } from './browser/browserManager.js';
export { ProxyManager, loadProxyConfig, validateProxy } from './proxy/proxyManager.js';
export { MailManager } from './mail/mailManager.js';
export { extractVerificationCode } from './mail/verificationCode.js';
export { StateManager } from './state/stateManager.js';
export { WorkflowEngine } from './workflows/workflowEngine.js';
export {
  runRegistrationWorkflow,
  runWorkflowBatch,
} from './workflows/registrationWorkflow.js';
export {
  detectFirefoxExecutable,
  getProjectRoot,
  resolveProjectPath,
} from './utils/platform.js';
