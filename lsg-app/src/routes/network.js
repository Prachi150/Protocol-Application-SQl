const express = require('express');
const router = express.Router();
const networkController = require('../controllers/networkController');
const firewallController = require('../controllers/network/firewall.controller');
const jwtAuth = require('../middleware/jwtAuth');

router.use(jwtAuth);

/**
 * @route GET /api/network/interfaces
 * @desc Get all network interfaces and their configurations
 * @access Private
 */
router.get('/interfaces', networkController.getAllNetworkInterfaces);

/**
 * @route GET /api/network/interfaces/:interfaceName/check
 * @desc Check if a network interface exists and get its details
 * @access Private
 */
router.get('/interfaces/:interfaceName/check', networkController.checkInterface);

/**
 * @route PUT /api/network/interfaces/:interfaceName
 * @desc Set network interface configuration
 * @access Private
 */
router.put('/interfaces/:interfaceName', networkController.setNetworkInterfaceConfig);

/**
 * @route GET /api/network/connectivity
 * @desc Check internet connectivity using multiple methods
 * @access Private
 */
router.get('/connectivity', networkController.checkInternetConnectivity);

/**
 * @route GET /api/network/firewall/status
 * @desc Get UFW firewall status including default policies and logging
 * @access Private
 */
router.get('/firewall/status', networkController.getUFWStatus);

/**
 * @route GET /api/network/firewall/rules
 * @desc Get all UFW firewall rules
 * @access Private
 */
router.get('/firewall/rules', networkController.getUFWRules);

/**
 * @route POST /api/network/firewall/rules
 * @desc Add new UFW firewall rules
 * @access Private
 */
router.post('/firewall/rules', firewallController.addRule);

/**
 * @route POST /api/network/firewall/enable
 * @desc Enable UFW firewall
 * @access Private
 */
router.post('/firewall/enable', firewallController.enableFirewall);

/**
 * @route POST /api/network/firewall/disable
 * @desc Disable UFW firewall
 * @access Private
 */
router.post('/firewall/disable', firewallController.disableFirewall);

/**
 * @route DELETE /api/network/firewall/rules/:ruleNum
 * @desc Delete a UFW firewall rule
 * @access Private
 */
router.delete('/firewall/rules/:ruleNum', firewallController.deleteRule);

module.exports = router; 