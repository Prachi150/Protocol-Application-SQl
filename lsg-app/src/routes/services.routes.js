const express = require('express');
const router = express.Router();
const jwtAuth = require('../middleware/jwtAuth');
const {
    getSshStatus, toggleSsh, setSshConfig,
    getFtpStatus, toggleFtp, setFtpConfig,
} = require('../controllers/services.controller');

const json = express.json();

router.use(jwtAuth);

router.get('/ssh/status',  getSshStatus);
router.post('/ssh/toggle', json, toggleSsh);
router.post('/ssh/config', json, setSshConfig);

router.get('/ftp/status',  getFtpStatus);
router.post('/ftp/toggle', json, toggleFtp);
router.post('/ftp/config', json, setFtpConfig);

module.exports = router;
