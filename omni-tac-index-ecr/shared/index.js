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
        const dbUser = USER;
        const dbPassword = PASS;
        const dbHost = HOST;
        const dbPort = PORT;

        const connectionString = `postgres://${dbUser}:${encodeURIComponent(dbPassword)}@${dbHost}:${dbPort}/${dbName}`;
        console.log("connectionString", connectionString);
        return connectionString;
    } catch (error) {
        throw "DB Connection Error";
    }
}


module.exports = { getConnection }