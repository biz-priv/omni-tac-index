module.exports.handler = async (event, context) => {
    console.log(`🙂 -> file: tacEventProcessor.js:3 -> context:`, context);

    console.log(
        `🙂 -> file: tacEventProcessor.js:3 -> event:`,
        JSON.stringify(event)
    );
};
