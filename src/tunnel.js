import sauceConnectLauncher from "sauce-connect-launcher";
import path from "path";
import _ from "lodash";
import logger from "./logger";
import settings from "./settings";
import analytics from "./global_analytics";

export default class Tunnel {
  constructor(options, sauceConnectLauncherMock = null) {
    this.options = _.assign({}, options);
    this.sauceConnectLauncher = sauceConnectLauncher;

    if (sauceConnectLauncherMock) {
      this.sauceConnectLauncher = sauceConnectLauncherMock;
    }
  }

  initialize() {
    return new Promise((resolve, reject) => {
      if (!this.options.username) {
        return reject("Sauce tunnel support is missing configuration: Sauce username.");
      }

      if (!this.options.accessKey) {
        return reject("Sauce tunnel support is missing configuration: Sauce access key.");
      }

      analytics.push("sauce-connect-launcher-download");
      /*eslint-disable no-console */
      return this.sauceConnectLauncher.download({
        logger: console.log.bind(console)
      }, (err) => {
        if (err) {
          analytics.mark("sauce-connect-launcher-download", "failed");
          logger.err("Failed to download sauce connect binary:");
          logger.err(err);
          logger.err("sauce-connect-launcher will attempt to re-download " +
            "next time it is run.");
          return reject(err);
        } else {
          analytics.mark("sauce-connect-launcher-download");
          return resolve();
        }
      });
    });

  }

  open() {
    this.tunnelInfo = null;
    const tunnelId = this.options.sauceTunnelId;
    const username = this.options.username;
    const accessKey = this.options.accessKey;
    let connectFailures = 0;

    logger.log(`Opening sauce tunnel [${ tunnelId }] for user ${ username}`);

    const connect = (/*runDiagnostics*/) => {
      return new Promise((resolve, reject) => {
        const logFilePath = `${path.resolve(settings.tempDir) }/build-${
           settings.buildId }_sauceconnect_${ tunnelId }.log`;
        const sauceOptions = {
          username,
          accessKey,
          tunnelIdentifier: tunnelId,
          readyFileId: tunnelId,
          verbose: settings.debug,
          verboseDebugging: settings.debug,
          logfile: logFilePath,
          port: settings.BASE_SELENIUM_PORT_OFFSET
        };

        if (this.options.fastFailRegexps) {
          sauceOptions.fastFailRegexps = this.options.fastFailRegexpss;
        }

        logger.debug(`calling sauceConnectLauncher() w/ ${ JSON.stringify(sauceOptions)}`);

        this.sauceConnectLauncher(sauceOptions, (err, sauceConnectProcess) => {
          if (err) {
            logger.debug("Error from sauceConnectLauncher():");
            logger.debug(err.message);

            if (err.message && err.message.indexOf("Could not start Sauce Connect") > -1) {
              return reject(err.message);
            } else if (settings.BAILED) {
              connectFailures++;
              // If some other parallel tunnel construction attempt has tripped the BAILED flag
              // Stop retrying and report back a failure.
              return reject(new Error("Bailed due to maximum number of tunnel retries."));
            } else {
              connectFailures++;

              if (connectFailures >= settings.MAX_CONNECT_RETRIES) {
                // We've met or exceeded the number of max retries, stop trying to connect.
                // Make sure other attempts don't try to re-state this error.
                settings.BAILED = true;
                return reject(new Error(`Failed to create a secure sauce tunnel after ${
                   connectFailures } attempts.`));
              } else {
                // Otherwise, keep retrying, and hope this is merely a blip and not an outage.
                logger.err(`>>> Sauce Tunnel Connection Failed!  Retrying ${
                   connectFailures } of ${ settings.MAX_CONNECT_RETRIES } attempts...`);

                return connect()
                  .then(resolve)
                  .catch(reject);
              }
            }
          } else {
            this.tunnelInfo = { process: sauceConnectProcess };
            return resolve();
          }
        });
      });
    };

    return connect();
  }

  close() {
    return new Promise((resolve) => {
      if (this.tunnelInfo) {
        logger.log(`Closing sauce tunnel [${ this.options.sauceTunnelId }]`);
        this.tunnelInfo.process.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });

  }
}