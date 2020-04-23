const getHeaders = () => {
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };
  const token = sessionStorage.getItem('token');
  if (token) {
    return {
      ...defaultHeaders,
      'Authorization': `Bearer ${token}`,
    };
  }
  return defaultHeaders;
};

const fetchData = async (path, payload) => {
  const options = {
    headers: getHeaders(),
  };
  if (payload) {
    options.body = JSON.stringify(payload);
    options.method = 'POST';
  }
  const response = await fetch(path, options);
  if (response.ok) {
    return response.json();
  }
  if (response.status === 401) {
    return null;
  }
  throw new Error('Could not fetch data');
};

const timeout = millis => new Promise((resolve, reject) => {
  const fail = () => reject(new Error('Request timeout'));
  setTimeout(fail, millis);
});

const fetchJSON = (path, payload = null) =>
    Promise.race([fetchData(path, payload), timeout(2000)]);

export default {

  async health() {
    return fetchJSON('/api/health');
  },

  async signIn(username, password) {
    return fetchJSON('/login', {
      username,
      password,
    });
  }
};
