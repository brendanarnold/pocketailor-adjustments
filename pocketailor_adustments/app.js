// App constants
var MAX_POST_LENGTH = 16384; // Should allow about 50 entries with 7100 bytes based on 142 bytes per entry, double to make sure
var POCKETAILOR_ADJUSTMENTS_SECRET = process.env.POCKETAILOR_ADJUSTMENTS_SECRET || "testing_secret";
var LOG_DELIMITER = "|";
var ADJUSTMENTS_MONGODB_COLLECTION_NAME = 'adjustments'
// var SERVER_OK_RESPONSE = 'pocketed';

// Define the format of the POST request
var SECRET_FIELD = "pocketailor_adjustments_secret"; // Actual secret defined in environment variable
var ADJUSTMENT_FIELD = "adjustment";
// Following is the prototype for the adjustment JSON
// Field abbreviated since MongoDB saves fields with each entry
// {
//     "g": Gender int 2: Male, 1: Female, 0: Unspecified
//     "b": Brand int RetailId
//     "r": Region int RegionId
//     "a": Adjustment of size int e.g. +1, 0, -1 means Size 8->10, 10 is right, 10->8
//     "i": App ID, GUID
//     "c": Conversion int ConversionId
//     "m": Measurement int MeasurementId
//     "v": Measurement value, double in DB default units
//     "t": Time logged, int unix time
// }


// General app requies
var http = require("http");
var querystring = require("querystring");

// Setup logging on Logentries
var info, warn;
if (process.env.LOGENTRIES_TOKEN) {
    logentries_logger = require("node-logentries").logger({
        token: process.env.LOGENTRIES_TOKEN,
    });
    info = logentries_logger.info;
    warn = logentries_logger.warn;
} else {
    info = console.log;
    warn = console.log;
}

// Setup MongoDB
var port = (process.env.VMC_APP_PORT || 3000);
var host = (process.env.VCAP_APP_HOST || 'localhost');
if (process.env.VCAP_SERVICES){
    var env = JSON.parse(process.env.VCAP_SERVICES);
    var db = env['mongodb-1.8'][0]['credentials'];
    var mongoUrl = "mongodb://" + db.username + ":" + db.password + "@" + db.hostname + ":" + db.port + "/" + db.db;
} else {
    var mongoUrl = "mongodb://localhost:27017/pocketailorAdjustmentsDBDev";
}

// Main setup of server
var server = http.createServer(processRequest)
server.listen(process.env.VMC_APP_PORT || 3000, null);

// Main server routine
function processRequest(req, res) {
    // First check is a POST request, if not then 404
    if (req.method != "POST") {
        // Some browsers e.g. Chrome, automatically follow up with a GET request 
        //  logThen404("Non POST request made: " + req.method, req, res);
        return;
    }
    // Then check if SSL, if not then 404 and log user-agent
    // AppFog resolves https at the proxy and sends plain text behind the proxy but includes a special header incase - see 
    // https://groups.google.com/forum/#!searchin/appfog-users/ssl/appfog-users/M6wAlGmUYaE/5MX80t2iPYwJ
    if (typeof req.headers["x-forwarded-proto"] !== 'undefined') {
        if (req.headers["x-forwarded-proto"] !== 'https') {
            logThen404("Non SSL request made", req, res);
            return;
        }
    }
    // Read in data
    dat = '';
    req.on('data', function(chunk) {
        dat += chunk;
        // limit the size of the request here
        if (dat.length > MAX_POST_LENGTH) {
            logThen404("Max POST exceeded", req, res);
            return;
        }
    });
    // When done reading in the data ...
    req.on('end', function() {
        // TODO: remove this
        console.log(dat);
        // Parse the POST query
        try {
            var q = querystring.parse(dat);
        } catch(e) {
            logThen404("Could not parse POST query string", req, res);
        }
        // Check all fields are present
        if (!isDef(q[SECRET_FIELD])) {
            logThen404("Missing secret field in query", req, res);
            return;
        }
        if (!isDef(q[ADJUSTMENT_FIELD])) {
            logThen404("Missing adjustment field in query", req, res);
            return;
        }
        // Check the secret string matches the server's
        if (q[SECRET_FIELD] !== POCKETAILOR_ADJUSTMENTS_SECRET) {
            logThen404("The secret field does not match the servers", req, res);
            return;
        }
        var adj = JSON.parse(q[ADJUSTMENT_FIELD]);
        // Now throw the adjustment into MongoDB
        require("mongodb").connect(mongoUrl, function(err, conn) {
            conn.collection(ADJUSTMENTS_MONGODB_COLLECTION_NAME, function (err, coll) {
                coll.insert(adj, {safe: true}, function(err) {
                    if (err) {
                        logThen404("Could not insert object into MongoDB:" + err, req, res);
                    } else {
                        // Everything went A-OK, (unless was problem with DB ...)
                        res.writeHead(200);
                        res.end();
                        // TODO: Remove this
                        console.log("Added to DB");
                    }
                });
            });
        });
        
    });
}

// You're going down clown ...
function logThen404(errTxt, req, res) {
    res.writeHead(404);
    res.end();
    info(errTxt + LOG_DELIMITER + "user-agent:" + req.headers["user-agent"] + LOG_DELIMITER + "ip:" + req.connection.remoteAddress);
}

// Shorter, I think?
function isDef(x) {
    return !(typeof x === 'undefined');
}
