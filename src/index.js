const aws = require('./aws');
const gh = require('./gh');
const config = require('./config');
const core = require('@actions/core');

function setOutput(label, ec2InstanceIds) {
  core.info(`setting output label:${label}  ec2InstanceIds:${ec2InstanceIds} ${typeof ec2InstanceIds}`);
  core.setOutput('label', label);
  core.setOutput('ec2-instance-ids', ec2InstanceIds);
}

async function start() {
  core.info("RocketLaneStage")
  //const label = config.generateUniqueLabel();
  const githubRegistrationToken = await gh.getRegistrationToken();
  //const ec2InstanceIds = await aws.startEc2Instance(label, githubRegistrationToken);
  const [ec2InstaceIdWithLabels,ec2InstacesIds,labels]=await aws.startEc2withUniqueLabelForEachInstance(config.input.runnerCount,githubRegistrationToken);
  core.info(`ec2InstaceId labels:-${JSON.stringify(ec2InstaceIdWithLabels)}`);
  core.info(`labels created :- ${JSON.stringify(labels)}`)
  core.info(`ec2Intances created :-${JSON.stringify(ec2InstacesIds)}`);
  setOutput(labels, ec2InstacesIds);
  await aws.waitForInstanceRunning(ec2InstacesIds);
  await gh.waitForRunnersRegistered(labels);
}

async function stop() {
  await aws.terminateEc2Instance();
  await gh.removeRunner();
}

(async function () {
  try {
    config.input.mode === 'start' ? await start() : await stop();
  } catch (error) {
    core.error(error);
    core.setFailed(error.message);
  }
})();
