const core = require('@actions/core');
const github = require('@actions/github');
const _ = require('lodash');
const config = require('./config');

// use the unique label to find the runner
// as we don't have the runner's id, it's not possible to get it in any other way
async function getRunners(label) {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const runners = await octokit.paginate('GET /repos/{owner}/{repo}/actions/runners', config.githubContext);
    const foundRunners = _.filter(runners, { labels: [{ name: label }] });
    return foundRunners.length > 0 ? foundRunners : null;
  } catch (error) {
    return null;
  }
}

// get GitHub Registration Token for registering a self-hosted runner
async function getRegistrationToken() {
  const octokit = github.getOctokit(config.input.githubToken);

  try {
    const response = await octokit.request('POST /repos/{owner}/{repo}/actions/runners/registration-token', config.githubContext);
    core.info('GitHub Registration Token is received');
    return response.data.token;
  } catch (error) {
    core.error('GitHub Registration Token receiving error');
    throw error;
  }
}

async function removeRunner() {
  const runners = await getRunners(config.input.label);
  const octokit = github.getOctokit(config.input.githubToken);

  // skip the runner removal process if the runner is not found
  if (!runners) {
    core.info(`GitHub self-hosted runner with label ${config.input.label} is not found, so the removal is skipped`);
    return;
  }

  const errors = [];
  for (const runner of runners) {
    try {
      await octokit.request('DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}', _.merge(config.githubContext, { runner_id: runner.id }));
      core.info(`GitHub self-hosted runner ${runner.name} is removed`);
    } catch (error) {
      core.error(`GitHub self-hosted runner removal error: ${error}`);
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    core.setFailed('Failures occurred when removing runners.');
  }

}
async function waitForRunnerRegistered(label, timeoutMinutes, retryIntervalSeconds) {
  let waitSeconds = 0;
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const runners = await getRunners(label);

      if (waitSeconds > timeoutMinutes * 60) {
        core.error(`GitHub self-hosted runner registration error for label ${label}`);
        clearInterval(interval);
        reject(`A timeout of ${timeoutMinutes} minutes is exceeded. Your AWS EC2 instance with label ${label} was not able to register itself in GitHub as a new self-hosted runner.`);
      }

      if (runners && runners.every((runner => runner.status === 'online'))) {
        core.info(`GitHub self-hosted runners for label ${label} are registered and ready to use`);
        clearInterval(interval);
        resolve();
      } else {
        waitSeconds += retryIntervalSeconds;
        core.info(`Checking for label ${label}...`);
      }
    }, retryIntervalSeconds * 1000);
  });
}
async function waitForRunnersRegistered(labels) {
  const timeoutMinutes = 5;
  const retryIntervalSeconds = 10;
  const quietPeriodSeconds = 30;


  core.info(`Waiting ${quietPeriodSeconds}s for the AWS EC2 instances to be registered in GitHub as new self-hosted runners`);
  await new Promise(r => setTimeout(r, quietPeriodSeconds * 1000));
  core.info(`Checking every ${retryIntervalSeconds}s if the GitHub self-hosted runners are registered`);

  return Promise.all(
    labels.map(label => waitForRunnerRegistered(label, timeoutMinutes, retryIntervalSeconds))
  );
}



module.exports = {
  getRegistrationToken,
  removeRunner,
  waitForRunnerRegistered,
  waitForRunnersRegistered
};
