// k6 Load Test Script for Platform API
// Usage: k6 run scripts/load_test_k6.js -e BASE_URL=http://localhost:8000
// Stays strictly within free-tier limits: 5 VUs, 30s duration

import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '5s', target: 5 },   // Ramp-up to 5 concurrent users
    { duration: '20s', target: 5 },  // Stay at 5 users
    { duration: '5s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],    // Error rate must be less than 1%
    http_req_duration: ['p(95)<500'],  // 95% of requests must complete below 500ms
  },
};

export default function () {
  const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

  const res = http.get(`${BASE_URL}/health`);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'status ok': (r) => r.json().status === 'ok',
  });

  sleep(0.5);
}
