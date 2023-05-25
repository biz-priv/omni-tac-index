const {
    USER,
    PASS,
    HOST,
    PORT,
} = process.env


/**
 * Config for connections
 * @param {*} env
 * @returns
 */
function getConnection(dbName) {
    try {
        // const dbUser = USER;
        const dbUser = "bceuser1";
        // const dbPassword = PASS;
        const dbPassword = "BizCloudExp1";
        // const dbHost = HOST;
        const dbHost = "omni-dw-prod.cnimhrgrtodg.us-east-1.redshift.amazonaws.com";
        const dbPort = PORT;

        const connectionString = `postgres://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;
        console.log("connectionString", connectionString);
        return connectionString;
    } catch (error) {
        throw "DB Connection Error";
    }
}


module.exports = { getConnection }