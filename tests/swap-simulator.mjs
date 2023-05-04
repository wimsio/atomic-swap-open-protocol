import { promises as fs } from 'fs';

import {
  Address,
  Assets, 
  Datum,
  MintingPolicyHash,
  NetworkEmulator,
  NetworkParams, 
  Program,
  Value, 
  textToBytes,
  TxOutput,
  Tx,
  UTxO,
} from "@hyperionbt/helios";


// Create an Instance of NetworkEmulator
const network = new NetworkEmulator();

// Network Parameters
const networkParamsFile = await fs.readFile('./src/preprod.json', 'utf8');
const networkParams = new NetworkParams(JSON.parse(networkParamsFile.toString()));

// Set the Helios compiler optimizer flag
let optimize = false;
const minAda = BigInt(2_000_000);  // minimum lovelace needed to send an NFT
const swapAmt = BigInt(100_000_000);  // minimum lovelace needed to send an NFT

// Set dummy tokenized product
const productMPH = MintingPolicyHash.fromHex(
    '16aa5486dab6527c4697387736ae449411c03dcd20a3950453e6779c'
    );
const productTN =  Array.from(new TextEncoder().encode('Product Asset Name'));

// Compile the swap script
const swapScript = await fs.readFile('./src/swap.hl', 'utf8');
const swapProgram = Program.new(swapScript);
const swapCompiledProgram = swapProgram.compile(optimize);

// Compile the beacon minting script
const beaconScript = await fs.readFile('./src/beacon.hl', 'utf8');
const beaconProgram = Program.new(beaconScript);
const beaconCompiledProgram = beaconProgram.compile(optimize);
const beaconMPH = beaconCompiledProgram.mintingPolicyHash;

// Construct the beacon asset
const beaconToken = [[textToBytes("Beacon Token"), BigInt(1)]];
const beaconAsset = new Assets([[beaconMPH, beaconToken]]);

// Create seller wallet - we add 10ADA to start
const seller = network.createWallet(BigInt(10_000_000));

// Create product tokens in seller wallet
const productAsset = new Assets();
productAsset.addComponent(
    productMPH,
    productTN,
    BigInt(10)
);

// Add Product Token to the seller wallet
network.createUtxo(seller, minAda, productAsset);

// Create buyer wallet - we add 10ADA to start
const buyer = network.createWallet(BigInt(10_000_000));

// Create buyer wallet - add 100ADA for swap
network.createUtxo(buyer, swapAmt);

// Now lets tick the network on 10 slots,
// this will allow the UTxOs to be created from Genisis
network.tick(BigInt(10));


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
const showWalletUTXOs = async () => {

     // Get the UTxOs in Buyer & Seller Wallets
     const utxosSeller = await network.getUtxos(seller.address);
     const utxosBuyer = await network.getUtxos(buyer.address);

     console.log("");
     console.log("Seller Wallet UTXOs:");
     console.log("-------------");
     for (const utxo of utxosSeller) {
         console.log("txId", utxo.txId.hex + "#" + utxo.utxoIdx);
         console.log("value", utxo.value.dump());
     }
     console.log("");
     console.log("Buyer Wallet UTXOs:");
     console.log("-------------");
     for (const utxo of utxosBuyer) {
         console.log("txId", utxo.txId.hex + "#" + utxo.utxoIdx);
         console.log("value", utxo.value.dump());
     }
}

/**
 * Prints out the UTXOs at the swap script address
 * @package
 */
const showScriptUTXOs = async () => {

    const swapUtxos = await network.getUtxos(Address.fromHashes(swapCompiledProgram.validatorHash));
    console.log("");
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
 * Get the UTXO at the swap address which contains the beacon token
 * @package
 * @param {} 
 * @returns {UTxO} utxo
 */
const getSwapUTXO = async () => {

    const swapUtxos = await network.getUtxos(Address.fromHashes(swapCompiledProgram.validatorHash));
    for (const utxo of swapUtxos) {
        // only one UTXO with beacon token should exist
        if (utxo.value.assets.mintingPolicies.includes(beaconMPH)) { 
            console.log("getSwapUTXO: UTXO with beacon found");
            return utxo;
        }
    }
}

/**
 * Determine the quantity of a product a buyer can purchase
 * given the amount he is willing to pay.
 * @package
 * @param {UTxO, number} utxo
 * @param {UTxO, number} utxospendAmt 
 * @returns {{number, number, number, number}} {buyPrice, buyQty, remQty, chgAmt}
 */
const calcQtyToBuy = async (utxo, spendAmt) => {

    if (spendAmt <= 0) {
        throw console.error("calcRemainder: spendAmt can't be negative");
    } 
    var qtyToBuy;
    var qtyRemainder;
    var changeAmt;
    const price = utxo.origOutput.datum.data.list[0].int;
    const qty = utxo.origOutput.datum.data.list[1].int;
    const diff = spendAmt - price * qty;

    assert(price > 0); // price must be greater than zero
    const unitAmt = spendAmt / price;  
    if (unitAmt < 1) {
        throw console.error("calcRemainder: insufficient funds")
    } else if (diff >= 0) { 
        qtyToBuy = qty;  // can purchase all available qty
        qtyRemainder = 0;
        changeAmt = spendAmt - qtyToBuy * price; // return the change to the buyer
    } else {
        qtyToBuy = unitAmt; 
        qtyRemainder = qty - unitAmt;  // calc the remaining qty at the utxo
        changeAmt = spendAmt - qtyToBuy * price; // return the change to the buyer
    }

    return { 
        buyPrice: price,
        buyQty: qtyToBuy,
        remQty: qtyRemainder,
        chgAmt: changeAmt
    }
}

/**
 * Return the askedAsset and offeredAsset inline Datum info.
 * @package
 * @param {UTxO, number} utxo
 * @returns {{number, number}} {askedAsset, offeredAsset}
 */
const getDatumInfo = async (utxo) => {

    return {
        askedAsset: utxo.origOutput.datum.data.list[0].int,
        offeredAsset: utxo.origOutput.datum.data.list[1].int
    }
}




/**
 * Initialize the swap smart contract and mint a beacon token.
 * @package
 * @param {number} askedAsset
 * @param {number} offeredAsset
 */
const initSwap = async (askedAsset, offeredAsset) => {

    try {

        console.log("");
        console.log("************ INIT SWAP ************");
        console.log("************ PRE-TEST *************");
        await showWalletUTXOs();
        
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

        // Add the mint to the tx
        tx.mintTokens(
            beaconMPH,
            beaconToken,
            beaconRedeemer
        )
        // Construct the swap datum
        const swapDatum = new (swapProgram.types.Datum)(
            askedAsset,
            offeredAsset
          )

        // Create product asset to be offered
        const productAsset = new Assets();
        productAsset.addComponent(
            productMPH,
            productTN,
            BigInt(offeredAsset)
        );

        // Attach the output with product asset, beacon token
        // and the swap datum to the swap script address
        const swapValue = new Value(minAda, productAsset).add(new Value(BigInt(0), beaconAsset));
        tx.addOutput(new TxOutput(
            Address.fromHashes(swapCompiledProgram.validatorHash),
            swapValue,
            Datum.inline(swapDatum._toUplcData())
        ));

        console.log("");
        console.log("************ EXECUTE BEACON MINTING CONTRACT ************");
        await tx.finalize(networkParams, seller.address, utxosSeller);

        console.log("");
        console.log("************ SUBMIT TX ************");
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs();
        await showScriptUTXOs();

        return true;

    } catch (err) {
        console.error("initSwap tx failed", err);
        return false;
    }
}

/**
 * Execute a swap with a given amount
 * @package
 * @param {number} spendAmt
 */
const updateSwap = async (askedAsset, offeredAsset) => {

    try {
        console.log("");
        console.log("************ EXECUTE UPDATE SWAP ************");
        console.log("***************** PRE-TEST ******************");
        
        // Tick the network on 10 more slots,
        network.tick(BigInt(10));
        await showWalletUTXOs();
        await showScriptUTXOs();

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
        const swapUtxo = await getSwapUTXO();
        tx.addInput(swapUtxo, swapRedeemer);  
        
        // Get the qty of the offeredAsset from the datum
        const datumInfo = await getDatumInfo(swapUtxo);

        // Construct the swap datum
        const swapDatum = new (swapProgram.types.Datum)(
            BigInt(askedAsset),
            BigInt(datumInfo.offeredAsset) + BigInt(offeredAsset)
          )

        // Create product asset to be offered
        const productAsset = new Assets();
        productAsset.addComponent(
            productMPH,
            productTN,
            BigInt(datumInfo.offeredAsset) + BigInt(offeredAsset)
        );
        // Build the output that includes the update product offered, beacon and 
        // swap datum
        const swapValue = new Value(minAda, productAsset).add(new Value(BigInt(0), beaconAsset));
        tx.addOutput(new TxOutput(
            Address.fromHashes(swapCompiledProgram.validatorHash),
            swapValue,
            Datum.inline(swapDatum._toUplcData())
        ));

        console.log("");
        console.log("************ EXECUTE SWAP VALIDATOR CONTRACT ************");
        await tx.finalize(networkParams, seller.address, utxosSeller);

        console.log("");
        console.log("************ SUBMIT TX ************");
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs();
        await showScriptUTXOs();

        return true;

    } catch (err) {
        console.error("updateSwap tx failed", err);
        return false;
    }
}


/**
 * Execute a swap with a given amount
 * @package
 * @param {number} spendAmt
 */
const assetSwap = async (spendAmt) => {

    try {
        console.log("");
        console.log("************ EXECUTE ASSET SWAP ************");
        console.log("***************** PRE-TEST *****************");

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));
        await showWalletUTXOs();
        await showScriptUTXOs();
        
        // Now we are able to get the UTxOs in Buyer & Seller Wallets
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
        const swapUtxo = await getSwapUTXO();
        tx.addInput(swapUtxo, swapRedeemer);   
        
        // Calc the amount of products remaining
        //const remainderProductAmt = await calcRemainder(swapUtxo, BigInt(spendAmt));
        const productToBuy = await calcQtyToBuy(swapUtxo, BigInt(spendAmt));

        // Construct the swap datum
        const swapDatum = new (swapProgram.types.Datum)(
            BigInt(productToBuy.buyPrice),  // askedAsset
            BigInt(productToBuy.remQty)     // offeredAsset
          )
        
        // Create the output with the swap datum to the swap script address
        const remainderProductAsset = new Assets();
        remainderProductAsset.addComponent(
            productMPH,
            productTN,
            BigInt(productToBuy.remQty)
        );
        // Build the output that includes the remaining product, beacon and 
        // swap datum
        const swapValue = new Value(minAda, remainderProductAsset).add(new Value(BigInt(0), beaconAsset));
        tx.addOutput(new TxOutput(
            Address.fromHashes(swapCompiledProgram.validatorHash),
            swapValue,
            Datum.inline(swapDatum._toUplcData())
        ));

        // Create the output to send the askedAsset to the seller address
        tx.addOutput(new TxOutput(
            seller.address,
            new Value(BigInt(spendAmt) - BigInt(productToBuy.chgAmt))
        ));

        // Creat the output for the product asset that was purchased to the buyer address
        const buyProductAsset = new Assets();
        buyProductAsset.addComponent(
            productMPH,
            productTN,
            BigInt(productToBuy.buyQty)
        );
        tx.addOutput(new TxOutput(
            buyer.address,
            new Value(minAda + BigInt(productToBuy.chgAmt), buyProductAsset))
        );

        console.log("");
        console.log("************ EXECUTE SWAP VALIDATOR CONTRACT ************");
        await tx.finalize(networkParams, buyer.address, utxosBuyer);

        console.log("");
        console.log("************ SUBMIT TX ************");
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs();
        await showScriptUTXOs();

        return true;

    } catch (err) {
        console.error("assetSwap tx failed", err);
        return false;
    }
}


/**
 * Close a swap position
 * @package
 */
const closeSwap = async () => {

    try {
        console.log("");
        console.log("************ EXECUTE CLOSE SWAP ************");
        console.log("**************** PRE-TEST ******************");
        
        // Tick the network on 10 more slots,
        network.tick(BigInt(10));
        await showWalletUTXOs();
        await showScriptUTXOs();

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
        const swapUtxo = await getSwapUTXO();
        tx.addInput(swapUtxo, swapRedeemer);   

        // Add the beacon minting script as a witness to the transaction
        tx.attachScript(beaconCompiledProgram);

        // Create an Beacon Minting Init Redeemer because we must always send a Redeemer with
        // a plutus script transaction even if we don't actually use it.
        const beaconRedeemer = (new beaconProgram.types.Redeemer.Burn())._toUplcData();

        // Create beacon token for burning
        const beaconToken = [[textToBytes("Beacon Token"), BigInt(-1)]];

        // Add the mint to the tx
        tx.mintTokens(
            beaconMPH,
            beaconToken,
            beaconRedeemer
        )

        // Get the qty of the offeredAsset from the datum
        const datumInfo = await getDatumInfo(swapUtxo);

        // Create product asset to be retrieved
        const productAsset = new Assets();
        productAsset.addComponent(
            productMPH,
            productTN,
            BigInt(datumInfo.offeredAsset)
        );
        // Build the output to send back to the seller the product
        // token locked at the swap address
        const swapValue = new Value(minAda, productAsset);
        tx.addOutput(new TxOutput(
            seller.address,
            swapValue
        ));

        console.log("");
        console.log("************ EXECUTE SWAP VALIDATOR CONTRACT ************");
        await tx.finalize(networkParams, seller.address, utxosSeller);

        console.log("");
        console.log("************ SUBMIT TX ************");
        // Submit Tx to the network
        const txId = await network.submitTx(tx);
        console.log("TxId", txId.dump());

        // Tick the network on 10 more slots,
        network.tick(BigInt(10));

        console.log("");
        console.log("************ POST-TEST ************");
        await showWalletUTXOs();
        await showScriptUTXOs();

        return true;

    } catch (err) {
        console.error("updateSwap tx failed", err);
        return false;
    }
}


await initSwap(15_000_000, 5);      // Initialize with price of 15 Ada and 5 product tokens
await updateSwap(10_000_000, 5);    // Change price to 10 Ada and add 5 more product tokens
await assetSwap(25_000_000);        // Swap 25 Ada and get as many product tokens as possible
await closeSwap();

