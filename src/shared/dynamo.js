const AWS = require("aws-sdk");
const db = new AWS.DynamoDB.DocumentClient();
const { get } = require("lodash");

async function Query(params) {
    try {
        const data = await dbRead(params);
        return data;
    } catch (e) {
        console.error(
            "DynamoDb query error. ",
            " Params: ",
            params,
            " Error: ",
            e
        );
    }
}

async function dbRead(params) {
    async function helper(params) {
        let result = await db.query(params).promise();
        let data = result.Items;
        if (result.LastEvaluatedKey) {
            params.ExclusiveStartKey = result.LastEvaluatedKey;
            data = data.concat(await helper(params));
        }
        return data;
    }
    let readData = await helper(params);
    return { Items: readData };
}

async function FilterQuery(params) {
    try {
        const data = await dbRead(params);
        return data.Items;
    } catch (e) {
        console.error(
            "DynamoDb query error. ",
            " Params: ",
            params,
            " Error: ",
            e
        );
        throw e;
    }
}

async function Put(params) {
    try {
        const data = await db.put(params).promise();
        return data;
    } catch (e) {
        console.error(
            "DynamoDb put error. ",
            " Params: ",
            params,
            " Error: ",
            e
        );
        throw e;
    }
}

async function Update(params) {
    try {
        const data = await db.update(params).promise();
        return data;
    } catch (e) {
        console.error(
            "DynamoDb update error. ",
            " Params: ",
            params,
            " Error: ",
            e
        );
        throw e;
    }
}

async function Get(params) {
    try {
        const data = await db.get(params).promise();
        return data;
    } catch (e) {
        console.error(
            "DynamoDb get error. ",
            " Params: ",
            params,
            " Error: ",
            e
        );
        throw e;
    }
}

async function putItem(tableName, item) {
    let params;
    try {
        params = {
            TableName: tableName,
            Item: item,
        };
        return await db.put(params).promise();
    } catch (e) {
        console.error("Put Item Error: ", e, "\nPut params: ", params);
        throw e;
    }
}

async function updateItem(tableName, key, item) {
    let params;
    try {
        const [expression, expressionAtts, expressionName] =
            await getUpdateExpressions(item, key);
        const params = {
            TableName: tableName,
            Key: key,
            UpdateExpression: expression,
            ExpressionAttributeValues: expressionAtts,
            ExpressionAttributeNames: expressionName,
        };
        return await db.update(params).promise();
    } catch (e) {
        console.error("Update Item Error: ", e, "\nUpdate params: ", params);
        throw e;
    }
}

async function checkAndUpdateDynamo(tableName, key, item) {
    try {
        let params = {
            TableName: tableName,
            Key: key,
        };
        const response = await Get(params);
        if (get(response, "Item", null)) {
            await updateItem(tableName, key, item);
        } else {
            await putItem(tableName, item);
        }
    } catch (e) {
        console.error(
            "CheckAndUpdateDynamoError: ",
            e,
            "\nCheckAndUpdateDynamoParam: ",
            params
        );
        throw e;
    }
}

async function deleteItem(tableName, key) {
    let params;
    try {
        params = {
            TableName: tableName,
            Key: key,
        };
        return await db.delete(params).promise();
    } catch (e) {
        console.error("delete Item Error: ", e, "\ndelete params: ", params);
        throw e;
    }
}

async function Scan(params) {
    const scanResults = [];
    let items;
    try {
        do {
            items = await db.scan(params).promise();
            items.Items.forEach((item) => scanResults.push(item));
            params.ExclusiveStartKey = items.LastEvaluatedKey;
        } while (typeof items.LastEvaluatedKey !== "undefined");
    } catch (e) {
        console.error(
            "DynamoDb scan error. ",
            " Params: ",
            params,
            " Error: ",
            e
        );
        throw e;
    }
    return scanResults;
}

async function batchWriteItems(params) {
    return await db.batchWrite(params).promise();
}

module.exports = {
    Query,
    Put,
    Update,
    Get,
    FilterQuery,
    Scan,
    dbRead,
    checkAndUpdateDynamo,
    deleteItem,
    batchWriteItems,
};
