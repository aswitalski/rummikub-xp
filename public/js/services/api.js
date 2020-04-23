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

const fetchData = async path => {
  const response = await fetch(path, {
    headers: getHeaders(),
  });
  if (response.ok) {
    return response.json();
  }
  if (response.status === 401) {
    return null;
  }
  throw new Error('Unknown error');  
};

const timeout = millis => new Promise((resolve, reject) => {
  const fail = () => reject(new Error('Request timeout'));
  setTimeout(fail, millis);
});

const fetchJSON = path => Promise.race([fetchData(path), timeout(2000)]);

export default {

  async health() {
    return fetchJSON('/api/health');
  },
};
