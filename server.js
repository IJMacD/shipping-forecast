const http = require('http');
const https = require('https');
const xmldom = require('xmldom');

const UPSTREAM_URL = "https://www.metoffice.gov.uk/weather/specialist-forecasts/coast-and-sea/print/shipping-forecast";

const port = process.env.PORT || 8000;

const server = http.createServer((request, response) => {

    if (request.url === "/style.css") {
        response.writeHead(200, "OK", { "Content-Type": "text/css" });
        response.write("ShippingForecast { font-family: sans-serif; max-width: 1200px; margin: 20px auto; } AreaForecast, GaleWarnings { display: block; margin-block-end: 1em; } Area { font-weight: bold; }");
        response.end();
        console.log(`${new Date().toISOString()} style`);
        return;
    }

    fetchString(UPSTREAM_URL).then(data => {
        // console.log(data);

        const parser = new xmldom.DOMParser();
        const doc = parser.parseFromString(data, "text/html");

        const galeWarnings = getGaleWarnings(doc);

        // console.log(galeWarnings);

        const areaForecasts = getAreaForecasts(doc);

        // for (const af of areaForecasts) {
        //     console.log(`${af.area}: ${af.forecast}`);
        // }

        const xml = formatOutput(galeWarnings, areaForecasts);

        response.writeHead(200, "OK", { "Content-Type": "text/xml", "Access-Control-Allow-Origin": "*" });

        response.write(`<?xml version="1.0" encoding="UTF-8"?>`);

        response.write(`<?xml-stylesheet href="style.css"?>`);

        response.write(xml);

        response.end();

        console.log(`${new Date().toISOString()} forecast`);
    });
});

server.listen(port);
console.log(`Listening on port ${port}`);


/**
 * @param {string[]} galeWarnings
 * @param {{ areas: string[]; forecast: string; }[]} areaForecasts
 */
function formatOutput(galeWarnings, areaForecasts) {
    const serializer = new xmldom.XMLSerializer();
    const imp = new xmldom.DOMImplementation();
    const outDoc = imp.createDocument("", "");

    const root = outDoc.createElement("ShippingForecast");

    outDoc.appendChild(root);

    if (galeWarnings.length) {
        const warningsEl = outDoc.createElement("GaleWarnings");
        root.appendChild(warningsEl);
        warningsEl.appendChild(outDoc.createTextNode("There are warnings of gales in "));

        for (const gw of galeWarnings) {
            const el = outDoc.createElement("Area");

            el.textContent = gw;

            warningsEl.appendChild(el);

            warningsEl.appendChild(outDoc.createTextNode(", "));
        }

        warningsEl.childNodes.item(warningsEl.childNodes.length - 3).textContent = " and ";
        warningsEl.childNodes.item(warningsEl.childNodes.length - 1).textContent = ".";
    }

    root.appendChild(outDoc.createTextNode("\nThe area forecasts for the next 24 hours:\n"));

    let prevForecast;
    let prevForecastEl;

    for (const af of areaForecasts) {
        if (af.forecast === prevForecast) {
            // We detected duplication
            // Do our own de-duplication
            for (const area of af.areas) {
                const areaEl = outDoc.createElement("Area");
                areaEl.textContent = area;

                if (prevForecastEl?.parentNode) {
                    prevForecastEl.parentNode.insertBefore(outDoc.createTextNode(", "), prevForecastEl);

                    prevForecastEl.parentNode.insertBefore(areaEl, prevForecastEl);
                }
            }
        } else {
            const el = outDoc.createElement("AreaForecast");
            root.appendChild(el);
            root.appendChild(outDoc.createTextNode("\n"));

            let first = true;

            for (const area of af.areas) {
                if (!first) {
                    el.appendChild(outDoc.createTextNode(", "));
                }

                const areaEl = outDoc.createElement("Area");
                areaEl.textContent = area;
                el.appendChild(areaEl);

                first = false;
            }

            el.appendChild(outDoc.createTextNode(" -\n"));

            const forecastEl = outDoc.createElement("Forecast");

            el.appendChild(forecastEl);

            const fParts = af.forecast.split("\n");

            const windEl = outDoc.createElement("Wind");
            windEl.textContent = fParts[0];
            forecastEl.appendChild(windEl);

            forecastEl.appendChild(outDoc.createTextNode("\n"));

            const seaEl = outDoc.createElement("SeaConditions");
            seaEl.textContent = fParts[1];
            forecastEl.appendChild(seaEl);

            forecastEl.appendChild(outDoc.createTextNode("\n"));

            const precipEl = outDoc.createElement("Precipitation");
            precipEl.textContent = fParts[2];
            forecastEl.appendChild(precipEl);

            forecastEl.appendChild(outDoc.createTextNode("\n"));

            const visEl = outDoc.createElement("Visibility");
            visEl.textContent = fParts[3];
            // Forecast doesn't use a full stop for the last item. We should add
            // it.
            if (!visEl.textContent.endsWith(".")) {
                visEl.textContent += ".";
            }
            forecastEl.appendChild(visEl);

            if (fParts.length > 4) {
                forecastEl.appendChild(outDoc.createTextNode("\n"));

                const icsEl = outDoc.createElement("Icing");
                // Forecast doesn't use a full stop for the last item. We should
                // add it.
                icsEl.textContent = fParts[4];
                if (!icsEl.textContent.endsWith(".")) {
                    icsEl.textContent += ".";
                }
                forecastEl.appendChild(icsEl);
            }

            prevForecast = af.forecast;
            prevForecastEl = forecastEl;

        }
    }

    const xml = serializer.serializeToString(outDoc);
    return xml;
}

/**
 * @param {Document} doc
 */
function getGaleWarnings(doc) {
    // const warningP = doc.querySelector(".warning");
    const galeWarningP = doc.getElementsByClassName("warning")[0];

    if (!galeWarningP) {
        return [];
    }

    const galeWarningText = galeWarningP.textContent;

    const galeWarningLines = galeWarningText?.split("\n") || [];
    const galeWarnings = [
        ...galeWarningLines.slice(2, galeWarningLines.length - 4),
        galeWarningLines[galeWarningLines.length - 2]
    ].map(w => w.replace(/[,.]$/, ""));

    return galeWarnings;
}

/**
 * @param {Document} doc
 */
function getAreaForecasts(doc) {
    const h3List = doc.getElementsByTagName("h3");

    let areaForecastH3;

    for (let i = 0; i < h3List.length; i++) {
        const h3 = h3List.item(i);
        if (h3?.textContent === "The area forecasts for the next 24 hours") {
            areaForecastH3 = h3;
            break;
        }
    }

    let areaForecasts = [];

    if (areaForecastH3) {
        let heading = areaForecastH3.nextSibling;

        while (heading) {
            if (heading.nodeType === doc.TEXT_NODE) {
                heading = heading.nextSibling;
            }

            if (heading?.nodeName !== "h3") {
                break;
            }

            let text = heading.nextSibling;

            if (text?.nodeType === doc.TEXT_NODE) {
                text = text.nextSibling;
            }

            const area = heading?.textContent?.trim().split("\n")[0] || "";
            const areas = area.split(",").map((/** @type {string} */ s) => s.trim());

            areaForecasts.push({
                areas,
                forecast: text?.textContent?.trim() || "",
            });

            heading = text?.nextSibling || null;
        }
    }

    return areaForecasts;
}

/**
 * @param {string} url
 */
function fetchString(url) {
    return new Promise((resolve, reject) => {
        https.get(url, response => {
            let buffer = "";

            response.on("data", chunk => buffer += chunk);

            response.on("end", () => resolve(buffer));

            response.on("error", reject);
        });
    });
}