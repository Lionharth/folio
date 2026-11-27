const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const candidate = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
  if (!fs.existsSync(resolved)) {
    if (
      (process.env.EAS_BUILD === 'true' || process.env.EAS_BUILD_PROFILE) &&
      process.env.ALLOW_MISSING_GOOGLE_SERVICES !== '1'
    ) {
      throw new Error(
        `Missing ${candidate}. EAS builds need the Firebase google-services.json file as a file secret, or set ALLOW_MISSING_GOOGLE_SERVICES=1 to build without FCM.`
      );
    }
    return config;
  }

  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile: candidate,
    },
  };
};
