import { promises as fs } from 'fs';

import {
  Address,
  Assets, 
  bytesToHex,
  bytesToText,
  ByteArrayData,
  CborData,
  ConstrData,
  Datum,
  hexToBytes,
  IntData,
  MintingPolicyHash,
  NetworkEmulator,
  NetworkParams, 
  Program,
  Value, 
  textToBytes,
  TxOutput,
  Tx,
  UTxO,
  ByteArray,
  PubKeyHash,
  WalletEmulator,
} from "@hyperionbt/helios";

export {
    approveEscrow,
    assetSwap,
    assetSwapEscrow,
    beaconMPH,
    closeSwap,
    escrowProgram,
    EscrowConfig,
    initSwap,
    getMphTnQty,
    appWallet,
    minAda,
    mintUserTokens,
    multiAssetSwapEscrow,
    optimize,
    network,
    showWalletUTXOs,
    SwapConfig,
    updateSwap
}

// Create an Instance of NetworkEmulator
const network = new NetworkEmulator();

// Network Parameters
const networkParamsFile = await fs.readFile('./src/preprod.json', 'utf8');
const networkParams = new NetworkParams(JSON.parse(networkParamsFile.toString()));

// Set the Helios compiler optimizer flag
let optimize = false;

// Global variables
const minAda = BigInt(5_000_000);        // minimum lovelace locked at swap contract
const minAdaVal = new Value(minAda);
const minChangeAda = BigInt(1_000_000);  // minimum lovelace needed to send back as change
const deposit = BigInt(5_000_000);        // 5 Ada deposit for escrow

// Create appWallet wallet - we add 10ADA to start
const appWallet = network.createWallet(BigInt(10_000_000));

// Create a new program swap script
const swapScript = await fs.readFile('./src/swap.hl', 'utf8');
const swapProgram = Program.new(swapScript);

// Define the swap config object which is used to uniquely create
// a swap script address for a given asset pair, beacon token and 
// seller pkh
class SwapConfig {
    constructor(askedMPH,
                askedTN, 
                offeredMPH, 
                offeredTN, 
                beaconMPH,  
                sellerPKH,
                escrowEnabled,
                escrowAddr,
                userTokenMPH) {
      this.askedMPH = askedMPH;
      this.askedTN = askedTN;
      this.offeredMPH = offeredMPH;
      this.offeredTN = offeredTN;
      this.beaconMPH = beaconMPH;
      this.sellerPKH = sellerPKH;
      this.escrowEnabled = escrowEnabled;
      this.escrowAddr = escrowAddr;
      this.userTokenMPH = userTokenMPH;
    }
}

// Compile the escrow script
const escrowScript = await fs.readFile('./src/escrow.hl', 'utf8');
const escrowProgram = Program.new(escrowScript);

// Define the escrow config object which is used to uniquely create
// an escrow script address for a given buyer pkh, seller pkh 
// and the appWallet pkh.
class EscrowConfig {
    constructor(buyerPKH, sellerPKH, appWalletPKH) {
      this.buyerPKH = buyerPKH;
      this.sellerPKH = sellerPKH;
      this.appWalletPKH = appWalletPKH;
    }
}

// Compile the Beacon minting script
const beaconScript = await fs.readFile('./src/beacon.hl', 'utf8');
const beaconProgram = Program.new(beaconScript);
beaconProgram.parameters = {["APP_WALLET_PKH"] : appWallet.pubKeyHash.hex};
const beaconCompiledProgram = beaconProgram.compile(optimize);
const beaconMPH = beaconCompiledProgram.mintingPolicyHash;

// Compile the Points minting script
const pointsScript = await fs.readFile('./src/points.hl', 'utf8');
const pointsProgram = Program.new(pointsScript);
const pointsCompiledProgram = pointsProgram.compile(optimize);
const pointsMPH = pointsCompiledProgram.mintingPolicyHash;

// Construct the Points asset
const pointsTN = textToBytes("Points Token");
const pointsToken = [[pointsTN, BigInt(1)]];

// Compile the Rewards minting script
const rewardsScript = await fs.readFile('./src/rewards.hl', 'utf8');
const rewardsProgram = Program.new(rewardsScript);
const rewardsCompiledProgram = rewardsProgram.compile(optimize);
const rewardsMPH = rewardsCompiledProgram.mintingPolicyHash;

// Construct the Rewards asset
const rewardsTN =  textToBytes("Rewards Token");
const rewardsToken = [[rewardsTN, BigInt(1)]];

// Read in the user token minting script
const userTokenPolicyScript = await fs.readFile('./src/userTokenPolicy.hl', 'utf8');
const userTokenPolicyProgram = Program.new(userTokenPolicyScript);

// Read in the user token validator script
const userTokenValScript = await fs.readFile('./src/userTokenValidator.hl', 'utf8');
const userTokenValProgram = Program.new(userTokenValScript);

/**
 * Throws an error if 'cond' is false.
 * @package
 * @param {boolean} cond 
 * @param {string} msg 
 */
function assert(cond, msg = "assertion failed") {
	if (!cond) {
		throw new Error(msg);
	}
}

/**
 * Prints out the UTXOs for the buyer and seller wallets
 * @package
 */
const showWalletUTXOs = async (name, wallet) => {

     // Get the UTxOs in Buyer & Seller Wallets
     const utxos = await network.getUtxos(wallet.address);

     console.log("");
     console.log(name + " Wallet UTXOs:");
     console.log("-------------");
     for (const utxo of utxos) {
         console.log("txId", utxo.txId.hex + "#" + utxo.utxoIdx);
         console.log("value", utxo.value.dump());
     }
}

/**
 * Prints out the UTXOs at the swap script address
 * @param {SwapConfig} swapConfig
 * @package
 */
const showSwapScriptUTXOs = async (swapConfig) => {

    swapProgram.parameters = {["ASKED_MPH"] : swapConfig.askedMPH};
    swapProgram.parameters = {["ASKED_TN"] : swapConfig.askedTN};
    swapProgram.parameters = {["OFFERED_MPH"] : swapConfig.offeredMPH};
    swapProgram.parameters = {["OFFERED_TN"] : swapConfig.offeredTN};
    swapProgram.parameters = {["BEACON_MPH"] : swapConfig.beaconMPH};
    swapProgram.parameters = {["SELLER_PKH"] : swapConfig.sellerPKH};
    swapProgram.parameters = {["ESCROW_ENABLED"] : swapConfig.escrowEnabled};
    swapProgram.parameters = {["ESCROW_ADDR"] : swapConfig.escrowAddr};
    swapProgram.parameters = {["USER_TOKEN_MPH"] : swapConfig.userTokenMPH};
    const swapCompiledProgram = swapProgram.compile(optimize);

    const swapScriptAddr = Address.fromHashes(swapCompiledProgram.validatorHash);
    const swapUtxos = await network.getUtxos(swapScriptAddr);
    console.log("");
    console.log("Swap Script Hash: ", swapCompiledProgram.validatorHash.hex);
    console.log("Swap Script UTXOs:");
    console.log("------------------");
    for (const utxo of swapUtxos) {
        console.log("txId", utxo.txId.hex + "#" + utxo.utxoIdx);
        console.log("value", utxo.value.dump());
        if (utxo.origOutput.datum) {
            console.log("datum", utxo.origOutput.datum.data.toSchemaJson());
        }
    }
}

/**
 * Prints out the UTXOs at the swap script address
 * @param {SwapConfig} swapConfig
 * @package
 */
const showEscrowScriptUTXOs = async (escrowConfig) => {

    escrowProgram.parameters = {["BUYER_PKH"] : escrowConfig.buyerPKH};
    escrowProgram.parameters = {["SELLER_PKH"] : escrowConfig.sellerPKH};
    escrowProgram.parameters = {["APP_WALLET_PKH"] : escrowConfig.appWalletPKH};
    const escrowCompiledProgram = escrowProgram.compile(optimize);

    const escrowUtxos = await network.getUtxos(Address.fromHashes(escrowCompiledProgram.validatorHash));
    console.log("");
    console.log("Escrow Script UTXOs:");
    console.log("------------------");
    for (const utxo of escrowUtxos) {
        console.log("txId", utxo.txId.hex + "#" + utxo.utxoIdx);
        console.log("value", utxo.value.dump());
        if (utxo.origOutput.datum) {
            console.log("datum", utxo.origOutput.datum.data.toSchemaJson());
        }
    }
}


/**
 * Prints out the UTXOs at the swap script address
 * @param {Address} address
 * @param {string} name
 * @package
 */
const showScriptUTXOs = async (address, name) => {

    const utxos = await network.getUtxos(address);
    console.log("");
    console.log(name + " Script UTXOs:");
    console.log("------------------");
    for (const utxo of utxos) {
        console.log("txId", utxo.txId.hex + "#" + utxo.utxoIdx);
        console.log("value", utxo.value.dump());
        if (utxo.origOutput.datum) {
            console.log("datum", utxo.origOutput.datum.data.toSchemaJson());
        }
    }
}

/**
 * Get the UTXO at the swap address which contains the beacon token
 * @package
 * @param {SwapConfig} swapConfig
 * @returns {UTxO} 
 */
const getSwapUTXO = async (swapConfig) => {

    swapProgram.parameters = {["ASKED_MPH"] : swapConfig.askedMPH};
    swapProgram.parameters = {["ASKED_TN"] : swapConfig.askedTN};
    swapProgram.parameters = {["OFFERED_MPH"] : swapConfig.offeredMPH};
    swapProgram.parameters = {["OFFERED_TN"] : swapConfig.offeredTN};
    swapProgram.parameters = {["BEACON_MPH"] : swapConfig.beaconMPH};
    swapProgram.parameters = {["SELLER_PKH"] : swapConfig.sellerPKH};
    swapProgram.parameters = {["ESCROW_ENABLED"] : swapConfig.escrowEnabled};
    swapProgram.parameters = {["ESCROW_ADDR"] : swapConfig.escrowAddr};
    swapProgram.parameters = {["USER_TOKEN_MPH"] : swapConfig.userTokenMPH};
    const swapCompiledProgram = swapProgram.compile(optimize);

    const swapUtxos = await network.getUtxos(Address.fromHashes(swapCompiledProgram.validatorHash));
    for (const utxo of swapUtxos) {
        // only one UTXO with beacon token should exist
        if (utxo.value.assets.mintingPolicies.includes(beaconMPH)) { 
            console.log("");
            console.log("getSwapUTXO: UTXO with beacon found");
            return utxo;
        }
    }
}

/**
 * Get the UTXO at the escrow address
 * @package
 * @param {PubKeyHash} buyerPKH
 * @param {PubKeyHash} sellerPKH
 * @param {string} orderId 
 * @returns {UTxO}
 */
const getEscrowUTXO = async (orderId, buyerPKH, sellerPKH, escrowConfig) => {

    console.log("getEscrowUTXO: ", escrowConfig);
    escrowProgram.parameters = {["BUYER_PKH"] : escrowConfig.buyerPKH};
    escrowProgram.parameters = {["SELLER_PKH"] : escrowConfig.sellerPKH};
    escrowProgram.parameters = {["APP_WALLET_PKH"] : escrowConfig.appWalletPKH};
    
    const escrowCompiledProgram = escrowProgram.compile(optimize);
    const escrowUtxos = await network.getUtxos(Address.fromHashes(escrowCompiledProgram.validatorHash));
    for (const utxo of escrowUtxos) {

        // only one UTXO with orderId, buyerPKH & sellerPKH should exist
        if (ByteArray.fromUplcData(utxo.origOutput.datum.data.list[0]).hex === (new ByteArray(orderId).hex) &&
            PubKeyHash.fromUplcData(utxo.origOutput.datum.data.list[1]).hex === buyerPKH.hex &&
            PubKeyHash.fromUplcData(utxo.origOutput.datum.data.list[3]).hex === sellerPKH.hex) { 
            console.log("");
            console.log("getEscrowUTXO: UTXO with order found");
            return utxo;
        }
    }
}

/**
 * Obtain the 1st minting policy hash, token name and qty from a value.
 * @package
 * @param {Value} value
 * @return {{mph: string, tn: string, qty: bigint}}
 */
const getMphTnQty = async (value) => {

    const valueMP = value.assets.mintingPolicies;

    // Check if the askedAsset is lovelace
    if (valueMP.length == 0) {
        return {
            mph: "",
            tn: "",
            qty: value.lovelace
        }
    } else { 
        // The askedAsset is a native token and should only contain 1 MPH
        assert(value.assets.mintingPolicies.length == 1);
        const valueMPH = value.assets.mintingPolicies[0];
        const valueTN = value.assets.getTokenNames(valueMPH)[0];
        const valueQty = value.assets.get(valueMPH, valueTN);

        return {
            mph: valueMPH.hex,
            tn: bytesToHex(valueTN),
            qty: valueQty
        }
    }
}

/**
 * Determine the quantity of a product a buyer can purchase
 * given the amount he is willing to pay.
 * @package
 * @param {UTxO, number} utxo
 * @param {UTxO, Value} swapAskedAssetValue
 * @returns {{askedAssetVal: Value, 
 *            buyAssetVal: Value,
 *            offeredAssetVal: Value,
 *            changeAssetVal: Value}} 
 */
const calcOrderDetails = async (utxo, swapAskedAssetValue) => {

    // swapAskedAssetValue can't have any negative values
    swapAskedAssetValue.assertAllPositive();

    // Get Values from the swap datum
    const askedAssetValue = Value.fromUplcData(utxo.origOutput.datum.data.list[0]);
    const offeredAssetValue = Value.fromUplcData(utxo.origOutput.datum.data.list[1]);

    const askedAssetMP = askedAssetValue.assets.mintingPolicies;
    var askedAssetMPH;
    var askedAssetTN;
    var askedAssetQty;

    // Check if the askedAsset is lovelace
    if (askedAssetMP.length == 0) {
        askedAssetMPH = askedAssetValue.assets.mintingPolicies;
        askedAssetTN = askedAssetValue.assets.getTokenNames(askedAssetMPH);
        askedAssetQty = askedAssetValue.lovelace;
    } else { 
        // The askedAsset is a native token and should only contain 1 MPH
        assert(askedAssetValue.assets.mintingPolicies.length == 1);
        askedAssetMPH = askedAssetValue.assets.mintingPolicies[0];
        askedAssetTN = askedAssetValue.assets.getTokenNames(askedAssetMPH)[0];
        askedAssetQty = askedAssetValue.assets.get(askedAssetMPH, askedAssetTN);
    }

    const offeredAssetMP = offeredAssetValue.assets.mintingPolicies;
    var offeredAssetMPH;
    var offeredAssetTN;
    var offeredAssetQty;

    // Check if the offeredAsset is lovelace
    if (offeredAssetMP.length == 0) {
        offeredAssetMPH = offeredAssetValue.assets.mintingPolicies;
        offeredAssetTN = offeredAssetValue.assets.getTokenNames(askedAssetMPH);
        offeredAssetQty = offeredAssetValue.lovelace;
    } else { 
        // The offeredAsset is a native token and should only contain 1 MPH
        assert(offeredAssetValue.assets.mintingPolicies.length == 1);
        offeredAssetMPH = offeredAssetValue.assets.mintingPolicies[0];
        offeredAssetTN = offeredAssetValue.assets.getTokenNames(offeredAssetMPH)[0];
        offeredAssetQty = offeredAssetValue.assets.get(offeredAssetMPH, offeredAssetTN);
    }

    const swapAskedAssetMP = swapAskedAssetValue.assets.mintingPolicies;
    var swapAskedAssetMPH;
    var swapAskedAssetTN;
    var swapAskedAssetQty;

    // Check if the swapAskedAsset is lovelace
    if (swapAskedAssetMP.length == 0) {
        swapAskedAssetMPH = swapAskedAssetValue.assets.mintingPolicies;
        swapAskedAssetTN = swapAskedAssetValue.assets.getTokenNames(askedAssetMPH);
        swapAskedAssetQty = swapAskedAssetValue.lovelace;
    } else { 
        // The swapAskedAsset is a native token and should only contain 1 MPH
        assert(swapAskedAssetValue.assets.mintingPolicies.length == 1);
        swapAskedAssetMPH = swapAskedAssetValue.assets.mintingPolicies[0];
        swapAskedAssetTN = swapAskedAssetValue.assets.getTokenNames(swapAskedAssetMPH)[0];
        swapAskedAssetQty = swapAskedAssetValue.assets.get(swapAskedAssetMPH, swapAskedAssetTN);
    }

    // Check that the askedAssets match
    if (askedAssetMPH.hex === swapAskedAssetMPH.hex &&
        bytesToHex(askedAssetTN) === bytesToHex(swapAskedAssetTN)) {
        console.log("");
        console.log("calcQtyToBuy: swap assets match");
    } else {
        throw console.error("calcQtyToBuy: swap assets don't match")
    }

    var qtyToBuy;
    var qtyRemainder;
    var changeAmt;
    
    const price = askedAssetQty;
    const qty = offeredAssetQty;
    const spendAmt = swapAskedAssetQty;
    const diff = spendAmt - price * qty; 

    assert(price > 0); // price must be greater than zero
    const orderAmt = spendAmt / price;  
    if (orderAmt < 1) {
        throw console.error("calcRemainder: insufficient funds")
    } else if (diff >= 0) { 
        qtyToBuy = qty;  // can purchase all available qty
        qtyRemainder = 0;
        changeAmt = spendAmt - qtyToBuy * price; // return the change to the buyer
    } else {
        qtyToBuy = orderAmt; 
        qtyRemainder = qty - orderAmt;  // calc the remaining qty at the utxo
        changeAmt = spendAmt - qtyToBuy * price; // return the change to the buyer
    }
    
    // If the change amount is too small to be sent back as change,
    // then just included it as part of the overall cost to avoid
    // sending back change to the buyer's wallet
    if (swapAskedAssetMP.length == 0) {
        // Check if the swapAskedAsset is lovelace
        if (changeAmt < minChangeAda) {
            changeAmt = 0;
        }
    } else if (changeAmt < 1) {
        changeAmt = 0;  
    } 
    
    // Create the updated offeredAsset
    const updatedOfferedAsset = new Assets();
    updatedOfferedAsset.addComponent(
        offeredAssetMPH,
        offeredAssetTN,
        BigInt(qtyRemainder)
    );
    const updatedOfferAssetValue = new Value(BigInt(0), updatedOfferedAsset);

    // Create the offeredAsset that is being bought
    const buyOfferedAsset = new Assets();
    buyOfferedAsset.addComponent(
        offeredAssetMPH,
        offeredAssetTN,
        BigInt(qtyToBuy)
    );
    const buyOfferAssetValue = new Value(BigInt(0), buyOfferedAsset);

    // Create the change for the asked asset
    var noChangeAmt;
    var changeAskedAssetValue;
    if (changeAmt == 0) {
        noChangeAmt = true;
    } else {
        noChangeAmt = false;
    }
    if (swapAskedAssetMP.length == 0) {
        // Change is in lovelace
        changeAskedAssetValue = new Value(changeAmt);
    } else {
        // Change is a native asset
        const changeAskedAsset = new Assets();
        changeAskedAsset.addComponent(
            askedAssetMPH,
            askedAssetTN,
            BigInt(changeAmt)
        );
        changeAskedAssetValue = new Value(BigInt(0), changeAskedAsset);
    }  

    const orderInfo = { 
        askedAssetVal: askedAssetValue,
        buyAssetVal: buyOfferAssetValue,
        offeredAssetVal: updatedOfferAssetValue,
        changeAssetVal: changeAskedAssetValue,
        noChange: noChangeAmt,
    }
    return orderInfo
}

/**
 * Return the askedAsset and offeredAsset inline Datum info.
 * @package
 * @param {UTxO, number} utxo
 * @returns {{askedAssetValue: Value, offeredAssetValue: Value}}
 */
const getSwapDatumInfo = async (utxo) => {

    const datumInfo = {
        askedAssetValue: Value.fromUplcData(utxo.origOutput.datum.data.list[0]),
        offeredAssetValue: Value.fromUplcData(utxo.origOutput.datum.data.list[1])
    }
    return datumInfo
}

/**
 * Return the datum info attached to the UTXO locked at escrow contract
 * @package
 * @param {UTxO} utxo
 * @returns {{  orderId: ByteArray, 
 *              buyerPKH: PubKeyHash,
 *              depositValue: Value,
 *              sellerPKH: PubKeyHash,
 *              orderValue: Value,
 *              productValue: Value}} 
 */
const getEscrowDatumInfo = async (utxo) => {

    const datumInfo = {
        orderId: ByteArray.fromUplcData(utxo.origOutput.datum.data.list[0]),
        buyerPKH: PubKeyHash.fromUplcData(utxo.origOutput.datum.data.list[1]),
        depositValue: Value.fromUplcData(utxo.origOutput.datum.data.list[2]),
        sellerPKH: PubKeyHash.fromUplcData(utxo.origOutput.datum.data.list[3]),
        orderValue: Value.fromUplcData(utxo.origOutput.datum.data.list[4]),
        productValue: Value.fromUplcData(utxo.origOutput.datum.data.list[5])
    }
    return datumInfo
}


/**
 * Mint user tokens including the reference token
 * @package
 * @param {WalletEmulator} user
 * @param {number} qty
 */
const mintUserTokens = async (user, qty) => {

    try {
        console.log("");
        console.log("************ MINT USER TOKENS ************");
        console.log("************ PRE-TEST *************");
        await showWalletUTXOs("User", user);

        // Compile the user token policy script
        userTokenPolicyProgram.parameters = {["APP_PKH"] : appWallet.pubKeyHash.hex};
        const userTokenPolicyCompiledProgram = userTokenPolicyProgram.compile(optimize);  
        const userTokenMPH = userTokenPolicyCompiledProgram.mintingPolicyHash;

        // Compile the user token validator script
        userTokenValProgram.parameters = {["APP_PKH"] : appWallet.pubKeyHash.hex};
        const userTokenValCompiledProgram = userTokenValProgram.compile(optimize);  
        const userTokenValHash = userTokenValCompiledProgram.validatorHash;

        // Get the UTxOs in User wallet
        const utxosUser = await network.getUtxos(user.address);

        // Start building the transaction
        const tx = new Tx();

        // Add the Seller UTXOs as inputs
        tx.addInputs(utxosUser);

        // Add the user token policy script as a witness to the transaction
        tx.attachScript(userTokenPolicyCompiledProgram);

        // Construct the user token name
        const today = "|" + Date.now().toString();
        const userTokenTN = user.pubKeyHash.hex + today;

        // Create the user token
        const userToken = [[textToBytes(userTokenTN), BigInt(qty)]];

        // Create the user token poicy redeemer 
        const userTokenPolicyRedeemer = (new userTokenPolicyProgram
            .types.Redeemer
            .Mint(user.pubKeyHash.hex, 
                  today, 
                  BigInt(qty)))
            ._toUplcData();
        
        const pkh = new ByteArrayData(user.pubKeyHash.hex);
        console.log("pkh test: ", pkh.toSchemaJson());

        // Add the mint to the tx
        tx.mintTokens(
            userTokenMPH,
            userToken,
            userTokenPolicyRedeemer
        )

        // Create the output for the reference user token
        const userTokenRef = [[textToBytes(userTokenTN), BigInt(1)]];
        const userTokenRefAsset = new Assets([[userTokenMPH, userTokenRef]]);
        const userTokenRefValue = new Value(minAda, userTokenRefAsset);
        console.log("userTokenRefValue: ", userTokenRefValue.toSchemaJson());
        
        tx.addOutput(new TxOutput(
            Address.fromHashes(userTokenValHash),
            userTokenRefValue
        ));
        
        // Create the output for the user tokens
        assert(qty >= 2);  // must mint a minimum of 2 tokens
        const userTokenWallet = [[textToBytes(userTokenTN), BigInt(qty - 1)]];
        const userTokenWalletAsset = new Assets([[userTokenMPH, userTokenWallet]]);
        const userTokenWalletValue = new Value(minAda, userTokenWalletAsset);
        console.log("userTokenWalletValue: ", userTokenWalletValue.toSchemaJson());
        
        tx.addOutput(new TxOutput(
            user.address,
            userTokenWalletValue
        ));

        // Add app wallet & user pkh as a signer which is required to mint user token
        tx.addSigner(user.pubKeyHash);
        tx.addSigner(appWallet.pubKeyHash);

        console.log("");
        console.log("************ EXECUTE USER TOKEN MINTING CONTRACT ************");
        await tx.finalize(networkParams, user.address, utxosUser);
        console.log("Tx Fee", tx.body.fee);
        console.log("Tx Execution Units", tx.witnesses.dump().redeemers);

        // Sign tx with user signature
        const signatureUserWallet = await user.signTx(tx);
        tx.addSignatures(signatureUserWallet);

        // Sign tx with appWallet signature
        const signatureAppWallet = await appWallet.signTx(tx);
        tx.addSignatures(signatureAppWallet);

        console.log("");
        console.log("************ SUBMIT TX ************");

        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs("User", user);
        await showScriptUTXOs(Address.fromHashes(userTokenValHash), "User Token");
        return {
            mph: userTokenMPH.hex,
            tn: userTokenTN
        }

    } catch (err) {
        console.error("mintUserToken tx failed", err);
        return false;
    }
}

/**
 * Initialize the swap smart contract and mint a beacon token.
 * @package
 * @param {Value} askedAssetValue
 * @param {Value} offeredAssetValue
 */
const initSwap = async (buyer, seller, askedAssetValue, offeredAssetValue, swapConfig, sellerTokenTN) => {

    try {
        console.log("");
        console.log("************ INIT SWAP ************");
        console.log("************ PRE-TEST *************");
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("Seller", seller);

        console.log("swapConfg: ", swapConfig);

        // Compile the swap script
        swapProgram.parameters = {["ASKED_MPH"] : swapConfig.askedMPH};
        swapProgram.parameters = {["ASKED_TN"] : swapConfig.askedTN};
        swapProgram.parameters = {["OFFERED_MPH"] : swapConfig.offeredMPH};
        swapProgram.parameters = {["OFFERED_TN"] : swapConfig.offeredTN};
        swapProgram.parameters = {["BEACON_MPH"] : swapConfig.beaconMPH};
        swapProgram.parameters = {["SELLER_PKH"] : swapConfig.sellerPKH};
        swapProgram.parameters = {["ESCROW_ENABLED"] : swapConfig.escrowEnabled};
        swapProgram.parameters = {["ESCROW_ADDR"] : swapConfig.escrowAddr};
        swapProgram.parameters = {["USER_TOKEN_MPH"] : swapConfig.userTokenMPH};
        const swapCompiledProgram = swapProgram.compile(optimize);  
        
        // Now we are able to get the UTxOs in Buyer & Seller Wallets
        const utxosSeller = await network.getUtxos(seller.address);

        // Start building the transaction
        const tx = new Tx();

        // Add the Seller UTXOs as inputs
        tx.addInputs(utxosSeller);

        // Add the beacon minting script as a witness to the transaction
        tx.attachScript(beaconCompiledProgram);

        // Create an Beacon Minting Init Redeemer because we must always send a Redeemer with
        // a plutus script transaction even if we don't actually use it.
        const beaconRedeemer = (new beaconProgram.types.Redeemer.Mint())._toUplcData();

        // Construct the Beacon asset & value
        const beaconTN = swapCompiledProgram.validatorHash.hex;
        const beaconToken = [[hexToBytes(beaconTN), BigInt(1)]];
        const beaconAsset = new Assets([[beaconMPH, beaconToken]]);
        const beaconValue = new Value(BigInt(0), beaconAsset);
        
        // Add the mint to the tx
        tx.mintTokens(
            beaconMPH,
            beaconToken,
            beaconRedeemer
        )

        // Construct the Seller Token value
        const sellerToken = [[textToBytes(sellerTokenTN), BigInt(1)]];
        const sellerTokenAsset = new Assets([[MintingPolicyHash.fromHex(swapConfig.userTokenMPH), sellerToken]]);
        const sellerTokenValue = new Value(BigInt(0), sellerTokenAsset);
        
        // Construct the swap datum
        const swapDatum = new (swapProgram.types.Datum)(
            askedAssetValue,
            offeredAssetValue
          )
        
        // Attach the output with product asset, beacon token
        // and the swap datum to the swap script address
        const swapValue = minAdaVal
                            .add(offeredAssetValue)
                            .add(beaconValue)
                            .add(sellerTokenValue);
    
        console.log("initSwap: swapValue: ", swapValue.toSchemaJson());
        tx.addOutput(new TxOutput(
            Address.fromHashes(swapCompiledProgram.validatorHash),
            swapValue,
            Datum.inline(swapDatum)
        ));

        // Add app wallet pkh as a signer which is required to mint beacon
        tx.addSigner(appWallet.pubKeyHash);

        console.log("");
        console.log("************ EXECUTE BEACON MINTING CONTRACT ************");
        await tx.finalize(networkParams, seller.address, utxosSeller);
        console.log("Tx Fee", tx.body.fee);
        console.log("Tx Execution Units", tx.witnesses.dump().redeemers);

        // Sign tx with appWallet signature
        const signatureAppWallet = await appWallet.signTx(tx);
        tx.addSignatures(signatureAppWallet);

        console.log("");
        console.log("************ SUBMIT TX ************");
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("Seller", seller);
        await showSwapScriptUTXOs(swapConfig);
        return true;

    } catch (err) {
        console.error("initSwap tx failed", err);
        return false;
    }
}

/**
 * Update swap askedAsset and/or offeredAsset
 * @package
 * @param {Value} askedAssetValue
 * @param {Value} offeredAssetValue
 */
const updateSwap = async (buyer, seller, askedAssetValue, offeredAssetValue, swapConfig, sellerTokenTN) => {

    try {
        console.log("");
        console.log("************ EXECUTE UPDATE SWAP ************");
        console.log("***************** PRE-TEST ******************");
        
        // Tick the network on 10 more slots,
        network.tick(BigInt(10));
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("Seller", seller);
        await showSwapScriptUTXOs(swapConfig);

        // Compile the swap script
        swapProgram.parameters = {["ASKED_MPH"] : swapConfig.askedMPH};
        swapProgram.parameters = {["ASKED_TN"] : swapConfig.askedTN};
        swapProgram.parameters = {["OFFERED_MPH"] : swapConfig.offeredMPH};
        swapProgram.parameters = {["OFFERED_TN"] : swapConfig.offeredTN};
        swapProgram.parameters = {["BEACON_MPH"] : swapConfig.beaconMPH};
        swapProgram.parameters = {["SELLER_PKH"] : swapConfig.sellerPKH};
        swapProgram.parameters = {["ESCROW_ENABLED"] : swapConfig.escrowEnabled};
        swapProgram.parameters = {["ESCROW_ADDR"] : swapConfig.escrowAddr};
        swapProgram.parameters = {["USER_TOKEN_MPH"] : swapConfig.userTokenMPH};
        const swapCompiledProgram = swapProgram.compile(optimize);  

        // Get the UTxOs in Seller Wallet
        const utxosSeller = await network.getUtxos(seller.address);

        // Start building the transaction
        const tx = new Tx();

        // Add the Seller UTXOs as inputs
        tx.addInputs(utxosSeller);

        // Add the script as a witness to the transaction
        tx.attachScript(swapCompiledProgram);

        // Create the swap redeemer
        const swapRedeemer = (new swapProgram.types.Redeemer.Update())._toUplcData();
        
        // Get the UTXO that has the swap datum
        const swapUtxo = await getSwapUTXO(swapConfig);
        tx.addInput(swapUtxo, swapRedeemer);  
        
        // Get the qty of the offeredAssetValue from the datum
        const datumInfo = await getSwapDatumInfo(swapUtxo);

        // Now calculate the new updated offerAssetValue
        const updatedOfferedAssetValue = datumInfo.offeredAssetValue.add(offeredAssetValue);
        
        // Confirm that the updated offeredAssetValue is positive
        updatedOfferedAssetValue.assertAllPositive();

        // Construct the swap datum
        const swapDatum = new (swapProgram.types.Datum)(
            askedAssetValue,
            updatedOfferedAssetValue
          )

        // Construct the Beacon value
        const beaconTN = swapCompiledProgram.validatorHash.hex;
        const beaconToken = [[hexToBytes(beaconTN), BigInt(1)]];
        const beaconAsset = new Assets([[beaconMPH, beaconToken]]);
        const beaconValue = new Value(BigInt(0), beaconAsset);

        // Construct the Seller Token value
        const sellerToken = [[textToBytes(sellerTokenTN), BigInt(1)]];
        const sellerTokenAsset = new Assets([[MintingPolicyHash.fromHex(swapConfig.userTokenMPH), sellerToken]]);
        const sellerTokenValue = new Value(BigInt(0), sellerTokenAsset);
        
        const swapValue = minAdaVal
                            .add(updatedOfferedAssetValue)
                            .add(beaconValue)
                            .add(sellerTokenValue);

        tx.addOutput(new TxOutput(
            Address.fromHashes(swapCompiledProgram.validatorHash),
            swapValue,
            Datum.inline(swapDatum)
        ));

        // Add seller wallet pkh as a signer which is required for an update
        tx.addSigner(seller.pubKeyHash);

        console.log("");
        console.log("************ EXECUTE SWAP VALIDATOR CONTRACT ************");
        await tx.finalize(networkParams, seller.address, utxosSeller);
        console.log("Tx Fee", tx.body.fee);
        console.log("Tx Execution Units", tx.witnesses.dump().redeemers);

        // Sign tx with sellers signature
        const signatures = await seller.signTx(tx);
        tx.addSignatures(signatures);

        console.log("");
        console.log("************ SUBMIT TX ************");
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("Seller", seller);
        await showSwapScriptUTXOs(swapConfig);
        return true;

    } catch (err) {
        console.error("updateSwap tx failed", err);
        return false;
    }
}

/**
 * Execute a swap with a given amount
 * @package
 * @param {Value} swapAskedAssetValue
 */
const assetSwap = async (buyer, seller, swapAskedAssetValue, swapConfig, sellerTokenTN, buyerTokenTN) => {

    try {
        console.log("");
        console.log("************ EXECUTE ASSET SWAP ************");
        console.log("***************** PRE-TEST *****************");

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("Seller", seller);
        await showSwapScriptUTXOs(swapConfig);

         // Compile the swap script
         swapProgram.parameters = {["ASKED_MPH"] : swapConfig.askedMPH};
         swapProgram.parameters = {["ASKED_TN"] : swapConfig.askedTN};
         swapProgram.parameters = {["OFFERED_MPH"] : swapConfig.offeredMPH};
         swapProgram.parameters = {["OFFERED_TN"] : swapConfig.offeredTN};
         swapProgram.parameters = {["BEACON_MPH"] : swapConfig.beaconMPH};
         swapProgram.parameters = {["SELLER_PKH"] : swapConfig.sellerPKH};
         swapProgram.parameters = {["ESCROW_ENABLED"] : swapConfig.escrowEnabled};
         swapProgram.parameters = {["ESCROW_ADDR"] : swapConfig.escrowAddr};
         swapProgram.parameters = {["USER_TOKEN_MPH"] : swapConfig.userTokenMPH};
         const swapCompiledProgram = swapProgram.compile(optimize); 
        
        // Now we are able to get the UTxOs in Buyer & Seller Wallets
        const utxosBuyer = await network.getUtxos(buyer.address);

        // Start building the transaction
        const tx = new Tx();

        // Add the Buyer UTXOs as inputs
        tx.addInputs(utxosBuyer);

        // Add the script as a witness to the transaction
        tx.attachScript(swapCompiledProgram);

        // Create the swap redeemer
        const swapRedeemer = (new swapProgram.types.Redeemer.Swap(buyer.pubKeyHash))._toUplcData();
        
        // Get the UTXO that has the swap datum
        const swapUtxo = await getSwapUTXO(swapConfig);
        tx.addInput(swapUtxo, swapRedeemer);   
        
        // Calc the amount of products remaining
        const orderDetails = await calcOrderDetails(swapUtxo, swapAskedAssetValue);

        console.log("swapAsset: askedAssetVal", orderDetails.askedAssetVal.dump());
        console.log("swapAsset: buyAssetVal", orderDetails.buyAssetVal.dump());
        console.log("swapAsset: changeAssetVal", orderDetails.changeAssetVal.dump());
        console.log("swapAsset: offeredAssetVal", orderDetails.offeredAssetVal.dump());
        console.log("swapAsset: noChange", orderDetails.noChange);

        // Construct the swap datum
        const swapDatum = new (swapProgram.types.Datum)(
            orderDetails.askedAssetVal,     // askedAsset
            orderDetails.offeredAssetVal    // offeredAsset
          )
        
        // Construct the Beacon asset
        const beaconTN = swapCompiledProgram.validatorHash.hex;
        const beaconToken = [[hexToBytes(beaconTN), BigInt(1)]];
        const beaconAsset = new Assets([[beaconMPH, beaconToken]]);
        const beaconValue = new Value(BigInt(0), beaconAsset);

        // Construct the Seller Token value
        const sellerToken = [[textToBytes(sellerTokenTN), BigInt(1)]];
        const sellerTokenAsset = new Assets([[MintingPolicyHash.fromHex(swapConfig.userTokenMPH), sellerToken]]);
        const sellerTokenValue = new Value(BigInt(0), sellerTokenAsset);
        
        const swapValue = minAdaVal
                            .add(orderDetails.offeredAssetVal)
                            .add(beaconValue)
                            .add(sellerTokenValue);

        // Create the output that goes back to the swap address
        tx.addOutput(new TxOutput(
            Address.fromHashes(swapCompiledProgram.validatorHash),
            swapValue,
            Datum.inline(swapDatum._toUplcData())
        ));

        // Create the output to send the askedAsset to the seller address
        if (orderDetails.noChange) {
            tx.addOutput(new TxOutput(
                seller.address,
                swapAskedAssetValue
            ));
        } else {
            tx.addOutput(new TxOutput(
                seller.address,
                swapAskedAssetValue.sub(orderDetails.changeAssetVal)
            ));
        }

        // Construct the Buyer Token value
        const buyerToken = [[textToBytes(buyerTokenTN), BigInt(1)]];
        const buyerTokenAsset = new Assets([[MintingPolicyHash.fromHex(swapConfig.userTokenMPH), buyerToken]]);
        const buyerTokenValue = new Value(BigInt(0), buyerTokenAsset);
        

        console.log("swapAsset:orderDetails.buyAssetVal: ", orderDetails.buyAssetVal.toSchemaJson());
        // Create the output that goes to the buyer
        tx.addOutput(new TxOutput(
            buyer.address,
            minAdaVal.add(orderDetails.buyAssetVal).add(buyerTokenValue)
        ));

        // Create the output to send to the buyer address for the change
        if (!orderDetails.noChange) {
            tx.addOutput(new TxOutput(
                buyer.address,
                minAdaVal.add(orderDetails.changeAssetVal)
            ));
        }

        // Add buyer wallet pkh as a signer which is required for an update
        tx.addSigner(buyer.pubKeyHash);

        console.log("");
        console.log("************ EXECUTE SWAP VALIDATOR CONTRACT ************");
        
        await tx.finalize(networkParams, buyer.address, utxosBuyer);

        // Sign tx with buyers signature
        const signatures = await buyer.signTx(tx);
        tx.addSignatures(signatures);

        console.log("Tx Fee", tx.body.fee);
        console.log("Tx Execution Units", tx.witnesses.dump().redeemers);
        

        console.log("");
        console.log("************ SUBMIT TX ************");
        
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("Seller", seller);
        await showSwapScriptUTXOs(swapConfig);
        return true;

    } catch (err) {
        console.error("assetSwap tx failed", err);
        return false;
    }
}

/**
 * Execute a swap with a given amount using an escrow script
 * @package
 * @param {Value} swapAskedAssetValue
 */
const assetSwapEscrow = async (buyer, seller, swapAskedAssetValue, swapConfig, escrowConfig) => {

    try {
        console.log("");
        console.log("******* EXECUTE ASSET SWAP ESCROW **********");
        console.log("***************** PRE-TEST *****************");

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("Seller", seller);
        await showSwapScriptUTXOs(swapConfig);
        await showEscrowScriptUTXOs(escrowConfig);

        // Compile the escrow script script
        escrowProgram.parameters = {["BUYER_PKH"] : escrowConfig.buyerPKH};
        escrowProgram.parameters = {["SELLER_PKH"] : escrowConfig.sellerPKH};
        escrowProgram.parameters = {["APP_WALLET_PKH"] : escrowConfig.appWalletPKH};
        const escrowCompiledProgram = escrowProgram.compile(optimize);

        // Compile the swap script
        swapProgram.parameters = {["ASKED_MPH"] : swapConfig.askedMPH};
        swapProgram.parameters = {["ASKED_TN"] : swapConfig.askedTN};
        swapProgram.parameters = {["OFFERED_MPH"] : swapConfig.offeredMPH};
        swapProgram.parameters = {["OFFERED_TN"] : swapConfig.offeredTN};
        swapProgram.parameters = {["BEACON_MPH"] : swapConfig.beaconMPH};
        swapProgram.parameters = {["SELLER_PKH"] : swapConfig.sellerPKH};
        swapProgram.parameters = {["ESCROW_ENABLED"] : swapConfig.escrowEnabled};
        swapProgram.parameters = {["ESCROW_ADDR"] : swapConfig.escrowAddr};
        swapProgram.parameters = {["USER_TOKEN_MPH"] : swapConfig.userTokenMPH};
        const swapCompiledProgram = swapProgram.compile(optimize); 

        // Get the UTxOs in Buyer Wallets
        const utxosBuyer = await network.getUtxos(buyer.address);

        // Start building the transaction
        const tx = new Tx();

        // Add the Buyer UTXOs as inputs
        tx.addInputs(utxosBuyer);

        // Add the script as a witness to the transaction
        tx.attachScript(swapCompiledProgram);

        // Create the swap redeemer
        const swapRedeemer = (new swapProgram.types.Redeemer.Swap())._toUplcData();
        
        // Get the UTXO that has the swap datum
        const swapUtxo = await getSwapUTXO(swapConfig);
        tx.addInput(swapUtxo, swapRedeemer);   
        
        // Calc the amount of products to buy
        const orderDetails = await calcOrderDetails(swapUtxo, swapAskedAssetValue);

        console.log("swapAsset: askedAssetVal", orderDetails.askedAssetVal.dump());
        console.log("swapAsset: buyAssetVal", orderDetails.buyAssetVal.dump());
        console.log("swapAsset: changeAssetVal", orderDetails.changeAssetVal.dump());
        console.log("swapAsset: offeredAssetVal", orderDetails.offeredAssetVal.dump());
        console.log("swapAsset: noChange", orderDetails.noChange);

        // Construct the swap datum
        const swapDatum = new (swapProgram.types.Datum)(
            orderDetails.askedAssetVal,     // askedAsset
            orderDetails.offeredAssetVal    // offeredAsset
          )

        // Construct the Beacon asset
        const beaconTN = swapCompiledProgram.validatorHash.hex;
        const beaconToken = [[hexToBytes(beaconTN), BigInt(1)]];
        const beaconAsset = new Assets([[beaconMPH, beaconToken]]);
        const beaconValue = new Value(BigInt(0), beaconAsset);
        
        const swapValue = minAdaVal
                            .add(orderDetails.offeredAssetVal)
                            .add(beaconValue);

        tx.addOutput(new TxOutput(
            Address.fromHashes(swapCompiledProgram.validatorHash),
            swapValue,
            Datum.inline(swapDatum._toUplcData())
        ));

        const depositValue = new Value(deposit);
        
        // Use timestamp for order id for now
        const orderId = Date.now().toString();  
        
        var orderValue;
        if (orderDetails.noChange) {
            orderValue = swapAskedAssetValue;
        } else {
            orderValue = swapAskedAssetValue.sub(orderDetails.changeAssetVal);
        }

        // Construct the escrow datum
        const escrowDatum = new (escrowProgram.types.Datum)(
            new ByteArray(orderId),
            buyer.pubKeyHash, 
            depositValue,
            seller.pubKeyHash,
            orderValue,
            orderDetails.buyAssetVal
            )

        // Create an output for the order total, depoist and products bought 
        // to the escrow script address
        tx.addOutput(new TxOutput(
            Address.fromHashes(escrowCompiledProgram.validatorHash),
            orderValue.add(depositValue).add(orderDetails.buyAssetVal),
            Datum.inline(escrowDatum._toUplcData())
        ));

        // Return change to the buyer if there is any
        if (!orderDetails.noChange) {
            tx.addOutput(new TxOutput(
                buyer.address,
                orderDetails.changeAssetVal
            ));
        }

        console.log("");
        console.log("************ EXECUTE SWAP VALIDATOR CONTRACT ************");
        
        await tx.finalize(networkParams, buyer.address, utxosBuyer);
        console.log("Tx Fee", tx.body.fee);
        console.log("Tx Execution Units", tx.witnesses.dump().redeemers);

        // Sign tx with buyers signature
        const signatures = await buyer.signTx(tx);
        tx.addSignatures(signatures);

        console.log("");
        console.log("************ SUBMIT TX ************");
        
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("Seller", seller);
        await showSwapScriptUTXOs(swapConfig);
        await showEscrowScriptUTXOs(escrowConfig);
        return orderId;

    } catch (err) {
        console.error("assetSwap tx failed", err);
        return false;
    }
}


/**
 * Execute a swap with a given amount using an escrow script
 * @package
 * @param {Value} swapAskedAssetValue
 */

const multiAssetSwapEscrow = async (buyer, 
                                    sellerUSDA,
                                    swapAskedAssetAdaValue, 
                                    swapConfigUSDA,
                                    sellerProduct,
                                    swapAskedAssetUSDAValue,
                                    swapConfigProduct,
                                    escrowConfig) => {

    try {
        console.log("");
        console.log("******* EXECUTE MULTI-ASSET SWAP ESCROW ********");
        console.log("******************** PRE-TEST ******************");

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("SellerUSDA", sellerUSDA);
        await showWalletUTXOs("SellerProduct", sellerProduct);
        await showSwapScriptUTXOs(swapConfigUSDA);
        await showSwapScriptUTXOs(swapConfigProduct);
        await showEscrowScriptUTXOs(escrowConfig);

        /**
         * Compile the swap script for the 1st trade (Ada -> USDA)
         */
        swapProgram.parameters = {["ASKED_MPH"] : swapConfigUSDA.askedMPH};
        swapProgram.parameters = {["ASKED_TN"] : swapConfigUSDA.askedTN};
        swapProgram.parameters = {["OFFERED_MPH"] : swapConfigUSDA.offeredMPH};
        swapProgram.parameters = {["OFFERED_TN"] : swapConfigUSDA.offeredTN};
        swapProgram.parameters = {["BEACON_MPH"] : swapConfigUSDA.beaconMPH};
        swapProgram.parameters = {["SELLER_PKH"] : swapConfigUSDA.sellerPKH};
        swapProgram.parameters = {["ESCROW_ENABLED"] : swapConfig.escrowEnabled};
        swapProgram.parameters = {["ESCROW_ADDR"] : swapConfig.escrowAddr};
        swapProgram.parameters = {["USER_TOKEN_MPH"] : swapConfig.userTokenMPH};
        const swapCompiledProgramUSDA = swapProgram.compile(optimize); 

        // Get the UTxOs in Buyer Wallets
        const utxosBuyer = await network.getUtxos(buyer.address);

        // Start building the transaction
        const tx = new Tx();

        // Add the Buyer UTXOs as inputs
        tx.addInputs(utxosBuyer);

        // Add the script as a witness to the transaction
        tx.attachScript(swapCompiledProgramUSDA);

        // Create the swap redeemer
        const swapRedeemerUSDA = (new swapProgram.types.Redeemer.Swap())._toUplcData();
        
        // Get the UTXO that has the swap datum
        const swapUtxoUSDA = await getSwapUTXO(swapConfigUSDA);
        tx.addInput(swapUtxoUSDA, swapRedeemerUSDA);   
        
        // Calc the amount of products to buy
        const orderDetailsUSDA = await calcOrderDetails(swapUtxoUSDA, swapAskedAssetAdaValue);

        console.log("swapAsset: askedAssetValUSDA", orderDetailsUSDA.askedAssetVal.dump());
        console.log("swapAsset: buyAssetValUSDA", orderDetailsUSDA.buyAssetVal.dump());
        console.log("swapAsset: changeAssetValUSDA", orderDetailsUSDA.changeAssetVal.dump());
        console.log("swapAsset: offeredAssetValUSDA", orderDetailsUSDA.offeredAssetVal.dump());
        console.log("swapAsset: noChangeUSDA", orderDetailsUSDA.noChange);

        // Construct the swap datum
        const swapDatumUSDA = new (swapProgram.types.Datum)(
            orderDetailsUSDA.askedAssetVal,     // askedAsset
            orderDetailsUSDA.offeredAssetVal    // offeredAsset
          )

        // Construct the Beacon asset
        const beaconTNUSDA = swapCompiledProgramUSDA.validatorHash.hex;
        const beaconTokenUSDA = [[hexToBytes(beaconTNUSDA), BigInt(1)]];
        const beaconAssetUSDA = new Assets([[beaconMPH, beaconTokenUSDA]]);
        const beaconValueUSDA = new Value(BigInt(0), beaconAssetUSDA);
        
        const swapValueUSDA = minAdaVal
                                .add(orderDetailsUSDA.offeredAssetVal)
                                .add(beaconValueUSDA);
        tx.addOutput(new TxOutput(
            Address.fromHashes(swapCompiledProgramUSDA.validatorHash),
            swapValueUSDA,
            Datum.inline(swapDatumUSDA._toUplcData())
        ));

        // Create the output to send the askedAsset to the seller address
        if (orderDetailsUSDA.noChange) {
            tx.addOutput(new TxOutput(
                sellerUSDA.address,
                swapAskedAssetAdaValue
            ));
        } else {
            tx.addOutput(new TxOutput(
                sellerUSDA.address,
                swapAskedAssetAdaValue.sub(orderDetailsUSDA.changeAssetVal)
            ));
            // Return change to the buyer if there is any
            tx.addOutput(new TxOutput(
                buyer.address,
                orderDetailsUSDA.changeAssetVal
            ));
        }

        /**
         * Compile the escrow and swap script for the 2nd trade (USDA -> Product)
         */
        escrowProgram.parameters = {["BUYER_PKH"] : escrowConfig.buyerPKH};
        escrowProgram.parameters = {["SELLER_PKH"] : escrowConfig.sellerPKH};
        escrowProgram.parameters = {["APP_WALLET_PKH"] : escrowConfig.appWalletPKH};
        const escrowCompiledProgram = escrowProgram.compile(optimize);

        swapProgram.parameters = {["ASKED_MPH"] : swapConfigProduct.askedMPH};
        swapProgram.parameters = {["ASKED_TN"] : swapConfigProduct.askedTN};
        swapProgram.parameters = {["OFFERED_MPH"] : swapConfigProduct.offeredMPH};
        swapProgram.parameters = {["OFFERED_TN"] : swapConfigProduct.offeredTN};
        swapProgram.parameters = {["BEACON_MPH"] : swapConfigProduct.beaconMPH};
        swapProgram.parameters = {["SELLER_PKH"] : swapConfigProduct.sellerPKH};
        swapProgram.parameters = {["ESCROW_ENABLED"] : swapConfig.escrowEnabled};
        swapProgram.parameters = {["ESCROW_ADDR"] : swapConfig.escrowAddr};
        swapProgram.parameters = {["USER_TOKEN_MPH"] : swapConfig.userTokenMPH};
        const swapCompiledProgramProduct = swapProgram.compile(optimize); 

        // Add the script as a witness to the transaction
        tx.attachScript(swapCompiledProgramProduct);

        // Create the swap redeemer
        const swapRedeemerProduct = (new swapProgram.types.Redeemer.Swap())._toUplcData();
        
        // Get the UTXO that has the swap datum
        const swapUtxoProduct = await getSwapUTXO(swapConfigProduct);
        tx.addInput(swapUtxoProduct, swapRedeemerProduct);   
        
        // Calc the amount of products to buy
        const orderDetailsProduct = await calcOrderDetails(swapUtxoProduct, swapAskedAssetUSDAValue);

        console.log("swapAsset: askedAssetValProduct", orderDetailsProduct.askedAssetVal.dump());
        console.log("swapAsset: buyAssetValProduct", orderDetailsProduct.buyAssetVal.dump());
        console.log("swapAsset: changeAssetValProduct", orderDetailsProduct.changeAssetVal.dump());
        console.log("swapAsset: offeredAssetValProduct", orderDetailsProduct.offeredAssetVal.dump());
        console.log("swapAsset: noChangeProduct", orderDetailsProduct.noChange);

        // Construct the swap datum
        const swapDatumProduct = new (swapProgram.types.Datum)(
            orderDetailsProduct.askedAssetVal,     // askedAsset
            orderDetailsProduct.offeredAssetVal    // offeredAsset
          )

        // Construct the Beacon asset
        const beaconTNProduct = swapCompiledProgramProduct.validatorHash.hex;
        const beaconTokenProduct = [[hexToBytes(beaconTNProduct), BigInt(1)]];
        const beaconAssetProduct = new Assets([[beaconMPH, beaconTokenProduct]]);
        const beaconValueProduct = new Value(BigInt(0), beaconAssetProduct);
        
        const swapValueProduct = minAdaVal
                                    .add(orderDetailsProduct.offeredAssetVal)
                                    .add(beaconValueProduct);
        tx.addOutput(new TxOutput(
            Address.fromHashes(swapCompiledProgramProduct.validatorHash),
            swapValueProduct,
            Datum.inline(swapDatumProduct._toUplcData())
        ));

        const depositValue = new Value(deposit);
        
        // Use timestamp for order id for now
        const orderId = Date.now().toString();  
        
        var orderValue;
        if (orderDetailsProduct.noChange) {
            orderValue = swapAskedAssetUSDAValue;
        } else {
            orderValue = swapAskedAssetUSDAValue.sub(orderDetailsProduct.changeAssetVal);
        }

        // Construct the escrow datum
        const escrowDatum = new (escrowProgram.types.Datum)(
            new ByteArray(orderId),
            buyer.pubKeyHash, 
            depositValue,
            sellerProduct.pubKeyHash,
            orderValue,
            orderDetailsProduct.buyAssetVal
            )

        // Create an output for the order total, depoist and products bought 
        // to the escrow script address
        tx.addOutput(new TxOutput(
            Address.fromHashes(escrowCompiledProgram.validatorHash),
            orderValue.add(depositValue).add(orderDetailsProduct.buyAssetVal),
            Datum.inline(escrowDatum._toUplcData())
        ));

        // Return change to the buyer if there is any
        if (!orderDetailsProduct.noChange) {
            tx.addOutput(new TxOutput(
                buyer.address,
                orderDetailsProduct.changeAssetVal
            ));
        }

        console.log("");
        console.log("************ EXECUTE SWAP VALIDATOR CONTRACT ************");
        
        await tx.finalize(networkParams, buyer.address, utxosBuyer);
        console.log("Tx Fee", tx.body.fee);
        console.log("Tx Execution Units", tx.witnesses.dump().redeemers);

        // Sign tx with buyers signature
        const signatures = await buyer.signTx(tx);
        tx.addSignatures(signatures);

        console.log("");
        console.log("************ SUBMIT TX ************");
        
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("SellerUSDA", sellerUSDA);
        await showWalletUTXOs("SellerProduct", sellerProduct);
        await showSwapScriptUTXOs(swapConfigUSDA);
        await showSwapScriptUTXOs(swapConfigProduct);
        await showEscrowScriptUTXOs(escrowConfig);
        return orderId;

    } catch (err) {
        console.error("assetSwap tx failed", err);
        return false;
    }
}


/**
 * Approve and release the order in the escrow smart contract
 * @package
 */
const approveEscrow = async (orderId, buyer, seller, escrowConfig) => {

    try {
        console.log("");
        console.log("************ EXECUTE APPROVE ESCROW ************");
        console.log("******************* PRE-TEST ******************");
        
        // Tick the network on 10 more slots,
        network.tick(BigInt(10));
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("Seller", seller);
        await showEscrowScriptUTXOs(escrowConfig);

        escrowProgram.parameters = {["BUYER_PKH"] : escrowConfig.buyerPKH};
        escrowProgram.parameters = {["SELLER_PKH"] : escrowConfig.sellerPKH};
        escrowProgram.parameters = {["APP_WALLET_PKH"] : escrowConfig.appWalletPKH};
        const escrowCompiledProgram = escrowProgram.compile(optimize);

        // Get the UTxOs in Seller and Buyer Wallet
        const utxosSeller = await network.getUtxos(seller.address);

        // Start building the transaction
        const tx = new Tx();

        // Add the script as a witness to the transaction
        tx.attachScript(escrowCompiledProgram);

        // Create the swap redeemer
        const escrowRedeemer = (new escrowProgram.types.Redeemer.Approve())._toUplcData();
        
        // Get the UTXO that has the swap datum
        const escrowUtxo = await getEscrowUTXO(orderId, buyer.pubKeyHash, seller.pubKeyHash, escrowConfig);
        tx.addInput(escrowUtxo, escrowRedeemer);  

        // Get the datum info from the UTXO locked at the escrow script address
        const escrowDatumInfo = await getEscrowDatumInfo(escrowUtxo);

        // Add the points minting script as a witness to the transaction
        tx.attachScript(pointsCompiledProgram);

        // Create a points minting policy redeemer
        const pointsRedeemer = (new pointsProgram.types.Redeemer.Mint())._toUplcData();

        // Add the points mint to the tx
        tx.mintTokens(
            pointsMPH,
            pointsToken,
            pointsRedeemer
        )

        // Create points asset to attached to a buyer output
        const pointsAsset = new Assets();
        pointsAsset.addComponent(
            pointsMPH,
            pointsTN,
            BigInt(1) // default to 1 point per tx for now
        );
        const pointsValue = new Value(BigInt(0), pointsAsset);

        // Create the output that will go to the buyer
        tx.addOutput(new TxOutput(
            buyer.address,
            escrowDatumInfo.depositValue.add(escrowDatumInfo.productValue).add(pointsValue)
        ));

        // Add the rewards minting script as a witness to the transaction
        tx.attachScript(rewardsCompiledProgram);

        // Create the rewards minting policy redeemer
        const rewardsRedeemer = (new rewardsProgram.types.Redeemer.Mint())._toUplcData();

        // Add the rewards mint to the tx
        tx.mintTokens(
            rewardsMPH,
            rewardsToken,
            rewardsRedeemer
        )
             
        // Create rewards asset to attached to a seller output
        const rewardsAsset = new Assets();
        rewardsAsset.addComponent(
            rewardsMPH,
            rewardsTN,
            BigInt(1) // default to 1 reward per tx for now
        );
        const rewardsValue = new Value(BigInt(0), rewardsAsset);

        // Create the output that will go to the seller
        tx.addOutput(new TxOutput(
            seller.address,
            escrowDatumInfo.orderValue.add(rewardsValue)
        ));

        console.log("");
        console.log("************ EXECUTE ESCROW APPROVE CONTRACT ************");
        
        await tx.finalize(networkParams, seller.address, utxosSeller);
        console.log("Tx Fee", tx.body.fee);
        console.log("Tx Execution Units", tx.witnesses.dump().redeemers);

        // Sign tx with sellers signature
        const sellerSignatures = await seller.signTx(tx);
        tx.addSignatures(sellerSignatures);

        // Sign tx with buyers signature
        const buyerSignatures = await seller.signTx(tx);
        tx.addSignatures(buyerSignatures);

        console.log("");
        console.log("************ SUBMIT TX ************");
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs("Buyer", buyer);
        await showWalletUTXOs("Seller", seller);
        await showEscrowScriptUTXOs(escrowConfig);
        return true;

    } catch (err) {
        console.error("approveEscrow tx failed", err);
        return false;
    }
}

/**
 * Close a swap position
 * @package
 */
const closeSwap = async (seller, swapConfig, sellerTokenTN) => {

    try {
        console.log("");
        console.log("************ EXECUTE CLOSE SWAP ************");
        console.log("**************** PRE-TEST ******************");
        
        // Tick the network on 10 more slots,
        network.tick(BigInt(10));
        await showWalletUTXOs("Seller", seller);
        await showSwapScriptUTXOs(swapConfig);

        // Compile the swap script
        swapProgram.parameters = {["ASKED_MPH"] : swapConfig.askedMPH};
        swapProgram.parameters = {["ASKED_TN"] : swapConfig.askedTN};
        swapProgram.parameters = {["OFFERED_MPH"] : swapConfig.offeredMPH};
        swapProgram.parameters = {["OFFERED_TN"] : swapConfig.offeredTN};
        swapProgram.parameters = {["BEACON_MPH"] : swapConfig.beaconMPH};
        swapProgram.parameters = {["SELLER_PKH"] : swapConfig.sellerPKH};
        swapProgram.parameters = {["ESCROW_ENABLED"] : swapConfig.escrowEnabled};
        swapProgram.parameters = {["ESCROW_ADDR"] : swapConfig.escrowAddr};
        swapProgram.parameters = {["USER_TOKEN_MPH"] : swapConfig.userTokenMPH};
        const swapCompiledProgram = swapProgram.compile(optimize); 

        // Get the UTxOs in Seller Wallet
        const utxosSeller = await network.getUtxos(seller.address);

        // Start building the transaction
        const tx = new Tx();

        // Add the Seller UTXOs as inputs
        tx.addInputs(utxosSeller);

        // Add the script as a witness to the transaction
        tx.attachScript(swapCompiledProgram);

        // Create the swap redeemer
        const swapRedeemer = (new swapProgram.types.Redeemer.Close())._toUplcData();
        
        // Get the UTXO that has the swap datum
        const swapUtxo = await getSwapUTXO(swapConfig);
        tx.addInput(swapUtxo, swapRedeemer);   

        // Add the beacon minting script as a witness to the transaction
        tx.attachScript(beaconCompiledProgram);

        // Create an Beacon Minting Init Redeemer because we must always send a Redeemer with
        // a plutus script transaction even if we don't actually use it.
        const beaconRedeemer = (new beaconProgram.types.Redeemer.Burn())._toUplcData();

        // Create beacon token for burning
        const beaconTN = swapCompiledProgram.validatorHash.hex;
        const beaconToken = [[hexToBytes(beaconTN), BigInt(-1)]];

        // Add the mint to the tx
        tx.mintTokens(
            beaconMPH,
            beaconToken,
            beaconRedeemer
        )

        // Construct the Seller Token value
        const sellerToken = [[textToBytes(sellerTokenTN), BigInt(1)]];
        const sellerTokenAsset = new Assets([[MintingPolicyHash.fromHex(swapConfig.userTokenMPH), sellerToken]]);
        const sellerTokenValue = new Value(BigInt(minAda), sellerTokenAsset);
        
        // Get the qty of the offeredAsset from the datum
        const datumInfo = await getSwapDatumInfo(swapUtxo);

        tx.addOutput(new TxOutput(
            seller.address,
            datumInfo.offeredAssetValue.add(sellerTokenValue)
        ));

        // Add app wallet pkh as a signer which is required to burn beacon
        tx.addSigner(appWallet.pubKeyHash);

        console.log("");
        console.log("************ EXECUTE SWAP VALIDATOR CONTRACT ************");
        
        await tx.finalize(networkParams, seller.address, utxosSeller);
        console.log("Tx Fee", tx.body.fee);
        console.log("Tx Execution Units", tx.witnesses.dump().redeemers);

        // Sign tx with appWallet signature
        const signatureAppWallet = await appWallet.signTx(tx);
        tx.addSignatures(signatureAppWallet);


        // Sign tx with sellers signature
        const signatures = await seller.signTx(tx);
        tx.addSignatures(signatures);

        console.log("");
        console.log("************ SUBMIT TX ************");
        
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs("Seller", seller);
        await showSwapScriptUTXOs(swapConfig);
        return true;

    } catch (err) {
        console.error("updateSwap tx failed", err);
        return false;
    }
}

