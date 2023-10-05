const assert = require('assert');
const fs = require('fs-extra');
const fetch = require('node-fetch');

const protocol = 'http';
const host = '127.0.0.1';
const port = '8080';
const server = `${protocol}://${host}:${port}`;

const express = require('express');
const app = express();

// Use a store to results associated with resultId
const resultsMap = {};

function calculateDistance(lat1, lon1, lat2, lon2) {
  const earthRadiusKm = 6371;
  const degToRad = Math.PI / 180;

  // Convert latitude and longitude from degrees to radians
  lat1 = lat1 * degToRad;
  lon1 = lon1 * degToRad;
  lat2 = lat2 * degToRad;
  lon2 = lon2 * degToRad;

  // Haversine formula
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  // Calculate the distance in kilometers
  return Number((earthRadiusKm * c).toFixed(2));
}

app.get('/cities-by-tag', async (req, res) => {
  try {
    const { tag, isActive } = req.query || {};
    const data = await fs.promises.readFile('addresses.json', 'utf8');
    const addresses = JSON.parse(data);

    // Check if the Authorization header is present and contains the expected token
    const authorizationHeader = req.headers['authorization'];
    if (
        !authorizationHeader ||
        authorizationHeader !== 'bearer dGhlc2VjcmV0dG9rZW4='
    ) {
      return res.status(401)
                .json({ message: 'Unauthorized' });
    }

    const cities = addresses.filter((address) =>
      address.isActive === Boolean(isActive) &&
      address.tags.includes(tag)
    );

    return res.status(200)
              .json({ cities });
  } catch (error) {
    return res.status(500)
              .json({ message: error.message });
  }
});

// POST /distance endpoint
app.get('/distance', async (req, res) => {
  try {
    const { from, to } = req.query || {};
    const data = await fs.promises.readFile('addresses.json', 'utf8');
    const addresses = JSON.parse(data);

    const fromCity = addresses.find(address => address.guid === from);
    const toCity = addresses.find(address => address.guid === to);

    const distance = calculateDistance(
        fromCity.latitude,
        fromCity.longitude,
        toCity.latitude,
        toCity.longitude
    );

    return res.status(200)
              .json({
                from: fromCity,
                to: toCity,
                unit: 'km',
                distance,
              });
  } catch (error) {
    return res.status(500)
              .json({ message: error.message });
  }
});

// POST /area endpoint
app.get('/area', async (req, res) => {
  try {
    const { from, distance } = req.query || {};
    const data = await fs.promises.readFile('addresses.json', 'utf8');
    const addresses = JSON.parse(data);
    const fromCity = addresses.find(address => address.guid === from);
    const result = [];

    for (const city of addresses) {
      const distanceKM = calculateDistance(
          fromCity.latitude,
          fromCity.longitude,
          city.latitude,
          city.longitude
      );
      if (distanceKM <= Number(distance) && fromCity.guid !== city.guid) {
        result.push(city);
      }
    }

    const resultId = '2152f96f-50c7-4d76-9e18-f7033bd14428';
    resultsMap[resultId] = result;

    const resultsUrl = `${server}/area-result/${resultId}`;

    return res.status(202)
        .json({
          resultsUrl
        });
  } catch (error) {
    return res.status(500)
        .json({ message: error.message });
  }
});


app.get('/area-result/:resultId', (req, res) => {
  try {
    const { resultId } = req.params || {};

    // Retrieve the result associated with the resultId
    const result = resultsMap[resultId];

    if (!result)
      return res.status(202).end();

    res.status(200)
       .json({ cities: result });
  } catch (error) {
    return res.status(500)
              .json({ message: error.message });
  }
});

app.get('/all-cities', (req, res) => {
  try {
    // Set headers for streaming data
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="all-cities.json"');

    // Stream the data to the response
    const stream = fs.createReadStream('./addresses.json');
    stream.pipe(res);
  } catch (error) {
    return res.status(500)
        .json({ message: error.message });
  }
});


app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});


(async () => {
  // get a city by tag ("excepteurus")
  let result = await fetch(`${server}/cities-by-tag?tag=excepteurus&isActive=true`);

  console.log('osman1');

  // oh, authentication is required
  assert.strictEqual(result.status, 401);
  result = await fetch(`${server}/cities-by-tag?tag=excepteurus&isActive=true`, {
    headers: { 'Authorization': 'bearer dGhlc2VjcmV0dG9rZW4=' }
  });

  console.log('osman2');
  // ah, that's better
  assert.strictEqual(result.status, 200);
  let body = await result.json();
  console.log('osman3');

  // we expect only one city to match
  assert.strictEqual(body.cities.length, 1);

  // let's just make sure it's the right one
  const city = body.cities[0];
  assert.strictEqual(city.guid, 'ed354fef-31d3-44a9-b92f-4a3bd7eb0408')
  assert.strictEqual(city.latitude, -1.409358);
  assert.strictEqual(city.longitude, -37.257104);

  // find the distance between two cities
  result = await fetch(`${server}/distance?from=${city.guid}&to=17f4ceee-8270-4119-87c0-9c1ef946695e`, {
    headers: { 'Authorization': 'bearer dGhlc2VjcmV0dG9rZW4=' }
  });
  console.log('osman4');

  // we found it
  assert.strictEqual(result.status, 200);
  body = await result.json();

  // let's see if the calculations agree
  assert.strictEqual(body.from.guid, 'ed354fef-31d3-44a9-b92f-4a3bd7eb0408');
  assert.strictEqual(body.to.guid, '17f4ceee-8270-4119-87c0-9c1ef946695e');
  assert.strictEqual(body.unit, 'km');
  assert.strictEqual(body.distance, 13376.38);

  // now it get's a bit more tricky. We want to find all cities within 250 km of the
  // the one we found earlier. That might take a while, so rather than waiting for the
  // result we expect to get a url that can be polled for the final result
  result = await fetch(`${server}/area?from=${city.guid}&distance=250`, {
    headers: { 'Authorization': 'bearer dGhlc2VjcmV0dG9rZW4=' },
    timeout: 25000
  });
  console.log('osman5');

  // so far so good
  assert.strictEqual(result.status, 202);
  body = await result.json();

  assert.strictEqual(body.resultsUrl, `${server}/area-result/2152f96f-50c7-4d76-9e18-f7033bd14428`);

  let status;
  do
  {
    result = await fetch(body.resultsUrl, {
      headers: { 'Authorization': 'bearer dGhlc2VjcmV0dG9rZW4=' }
    });
    console.log('osman6');
    status = result.status;
    // return 202 while the result is not yet ready, otherwise 200
    assert.ok(status === 200 || status === 202, 'Unexpected status code');

    // let's wait a bit if the result is not ready yet
    if (status === 202) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  while (status !== 200)

  // so we got a result. let's see if it looks as expected
  body = await result.json();
  let cities = body.cities;
  assert.strictEqual(cities.length, 15);

  // and let's look at a sample
  const filteredByAddress = cities.filter(city => city.address === '859 Cyrus Avenue, Devon, Missouri, 1642');
  assert.strictEqual(filteredByAddress.length, 1);
  console.log('osman7');
  // okay, nice we got this far. we are almost there. but let's have an endpoint
  // for downloading all cites.
  // that's quite a bit of data, so make sure to support streaming
  result = await fetch(`${server}/all-cities`, {
    headers: { 'Authorization': 'bearer dGhlc2VjcmV0dG9rZW4=' }
  });
  console.log('osman8');

  if (await fs.exists('./all-cities.json')) {
    await fs.remove('./all-cities.json');
  }

  await new Promise((resolve, reject) => {
    const dest = fs.createWriteStream('./all-cities.json');
    result.body.on('error', err => {
      reject(err);
    });
    dest.on('finish', () => {
      resolve();
    });
    dest.on('error', err => {
      reject(err);
    });
    result.body.pipe(dest);
  });

  // are they all there?
  const file = await fs.readFile('./all-cities.json');
  cities = JSON.parse(file);
  assert.strictEqual(cities.length, 100000);

  console.log('You made it! Now make your code available on git and send us a link');
})().catch(err => {
  console.log(err);
});
