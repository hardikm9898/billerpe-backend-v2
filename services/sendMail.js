const nodemailer = require('nodemailer');
require('dotenv').config();

// Create reusable transporter
function createMailTransporter() {
	return nodemailer.createTransport({
		service: 'gmail', // or 'outlook', 'yahoo', etc.
		auth: {
			user: "support@billerpe.com", // your email
			pass: "cpfwrvfpyvuwtjpj" // your app password
		},
		// Optional: for other email providers
		// host: 'smtp.gmail.com',
		// port: 587,
		// secure: false, // true for 465, false for other ports
	});
}
const getMailContent = (data) => {
	const { name, UserID, password, phone_no, email, business_name, pincode, address } = data;
	return `
    <!DOCTYPE>
<html>
<?php error_reporting(0); ?>

<head>

	<meta http-equiv="Content-type" content="text/html; charset=utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
	<meta http-equiv="X-UA-Compatible" content="IE=edge" />
	<!-- <meta name="format-detection" content="date=no" />
	<meta name="format-detection" content="address=no" />
	<meta name="format-detection" content="telephone=no" />
	<meta name="x-apple-disable-message-reformatting" /> -->
	<!--[if !mso]><!-->
	<link href="https://fonts.googleapis.com/css?family=PT+Sans:400,400i,700,700i&display=swap" rel="stylesheet" />
	<!--<![endif]-->
	<title>Email Template</title>



	<style type="text/css" media="screen">
		body {
			padding: 0 !important;
			margin: 0 auto !important;
			display: block !important;
			min-width: 100% !important;
			width: 100% !important;
			background: #fff;
			-webkit-text-size-adjust: none
		}

		a {
			color: #c5202b;
			text-decoration: none
		}

		p {
			padding: 0 !important;
			margin: 0 !important
		}

		img {
			margin: 0 !important;
			-ms-interpolation-mode: bicubic;
		}

		a[x-apple-data-detectors] {
			color: inherit !important;
			text-decoration: inherit !important;
			font-size: inherit !important;
			font-family: inherit !important;
			font-weight: inherit !important;
			line-height: inherit !important;
		}

		.btn-16 a {
			display: block;
			padding: 15px 35px;
			text-decoration: none;
		}

		.btn-20 a {
			display: block;
			padding: 15px 35px;
			text-decoration: none;
		}

		.l-white a {
			color: #ffffff;
		}

		.l-black a {
			color: #282828;
		}

		.l-pink a {
			color: #c5202b;
		}

		.l-grey a {
			color: #6e6e6e;
		}

		.l-purple a {
			color: #9128df;
		}

		.gradient {
			background: linear-gradient(to right, #f0c7ca 0%, #c5202b 100%);
		}

		.btn-secondary {
			border-radius: 10px;
			background: linear-gradient(to right, #9028df 0%, #f3189e 100%);
		}


		/* Mobile styles */
		@media only screen and (max-device-width: 480px),
		only screen and (max-width: 480px) {
			.mpx-10 {
				padding-left: 10px !important;
				padding-right: 10px !important;
			}

			.mpx-15 {
				padding-left: 15px !important;
				padding-right: 15px !important;
			}

			u+.body .gwfw {
				width: 100% !important;
				width: 100vw !important;
			}

			.td,
			.m-shell {
				width: 100% !important;
				min-width: 100% !important;
			}

			.mt-left {
				text-align: left !important;
			}

			.mt-center {
				text-align: center !important;
			}

			.mt-right {
				text-align: right !important;
			}

			.me-left {
				margin-right: auto !important;
			}

			.me-center {
				margin: 0 auto !important;
			}

			.me-right {
				margin-left: auto !important;
			}

			.mh-auto {
				height: auto !important;
			}

			.mw-auto {
				width: auto !important;
			}

			.fluid-img img {
				width: 100% !important;
				max-width: 100% !important;
				height: auto !important;
			}

			.column,
			.column-top,
			.column-dir-top {
				float: left !important;
				width: 100% !important;
				display: block !important;
			}

			.m-hide {
				display: none !important;
				width: 0 !important;
				height: 0 !important;
				font-size: 0 !important;
				line-height: 0 !important;
				min-height: 0 !important;
			}

			.m-block {
				display: block !important;
			}

			.mw-15 {
				width: 15px !important;
			}

			.mw-2p {
				width: 2% !important;
			}

			.mw-32p {
				width: 32% !important;
			}

			.mw-49p {
				width: 49% !important;
			}

			.mw-50p {
				width: 50% !important;
			}

			.mw-100p {
				width: 100% !important;
			}

			.mmt-0 {
				margin-top: 0 !important;
			}
		}
	</style>
</head>

<body class="body" style="padding:0 !important; margin:0 auto !important; display:block !important; min-width:100% !important; width:100% !important; background:#fff; -webkit-text-size-adjust:none;">
	<center>
		<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0; padding: 0; width: 100%; height: 100%;" bgcolor="#f8f8f8" class="gwfw">
			<tr>
				<td style="margin: 0; padding: 0; width: 100%; height: 100%;" align="center" valign="top">
					<table width="600" border="0" cellspacing="0" cellpadding="0" class="m-shell">
						<tr>
							<td class="td" style="width:600px; min-width:600px; font-size:0pt; line-height:0pt; padding:0; margin:0; font-weight:normal;">
								<table width="100%" border="0" cellspacing="0" cellpadding="0">
									<tr>
										<td class="mpx-10">
											<!-- Top -->
											<table width="100%" border="0" cellspacing="0" cellpadding="0">
												<tr>
													<td class="text-12 c-grey l-grey a-right py-20" style="font-size:12px; line-height:16px; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; color:#6e6e6e; text-align:right; padding-top: 20px; padding-bottom: 20px;">
														<!-- <a href="#" target="_blank" class="link c-grey" style="text-decoration:none; color:#6e6e6e;"><span class="link c-grey" style="text-decoration:none; color:#6e6e6e;">View this email in your browser</span></a> -->
													</td>
												</tr>
											</table>
											<!-- END Top -->

											<!-- Container -->
											<table width="100%" border="0" cellspacing="0" cellpadding="0">
												<tr>
													<td class="gradient pt-10" style="border-radius: 10px 10px 0 0; padding-top: 10px;" bgcolor="#f3189e">
														<table width="100%" border="0" cellspacing="0" cellpadding="0">
															<tr>
																<td style="border-radius: 10px 10px 0 0;" bgcolor="#ffffff">
																	<!-- Logo -->
																	<table width="100%" border="0" cellspacing="0" cellpadding="0">
																		<tr>
																			<td class="img-center p-30 px-15" style="font-size:0pt; line-height:0pt; text-align:center; padding: 30px; padding-left: 15px; padding-right: 15px;">
																				<a href="https://www.billerpe.com/" target="_blank">
																				<img src="https://uatbackend.billerpe.com/images/logo-png.png" width="160" border="0" style="height:auto" alt="" />
																				<!-- <img src="https://pos.billerpe.com/static/media/final%20logo.cf3291e50e4d33d806637dfa091bd7e7.svg" width="160" height="55" border="0" alt="" /> -->
																				</a>
																			</td>
																		</tr>
																	</table>
																	<!-- Logo -->

																	<!-- Main -->
																	<table width="100%" border="0" cellspacing="0" cellpadding="0">
																		<tr>
																			<td class="px-50 mpx-15" style="padding-left: 50px; padding-right: 50px;">
																				<!-- Section - Intro -->
																				<table width="100%" border="0" cellspacing="0" cellpadding="0">
																					<tr>
																						<td class="pb-50" style="padding-bottom: 30px;">
																							<table width="100%" border="0" cellspacing="0" cellpadding="0">

																								<tr>
																									<td class="title-36 a-center pb-15" style="font-size:36px; line-height:40px; color:#282828; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; text-align:center; padding-bottom: 15px;">
																										<!-- <strong>Hey, welcome!</strong> -->
																										<strong>Welcome to BillerPe — Your Account Details Inside</strong>
																									</td>
																								</tr>
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
																										Dear ${name},
																									</td>
																								</tr>
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																										<strong>Thank you for choosing BillerPe! 🎉</strong>
																									</td>
                                                                                                </tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
																										We’re excited to have you on board. Below are your account details and the information you provided during registration:
																									</td>
                                                                                                </tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																										<strong>🧾 Your Account Credentials</strong>
																									</td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; padding-bottom: 10px;line-height: 1.4;">
																										<p style="margin: 0; font-size: 16px;">User ID : ${UserID} <br> Password : ${password} </p>
																								    </td>
                                                                                                </tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																										🔐 Please keep these credentials safe and do not share them with anyone.
																									</td>
                                                                                                </tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																										<strong>📌 Your Registered Details</strong>
																									</td>
                                                                                                </tr>
                                                                                                <tr>
																									<!--  data -->
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; padding-bottom: 10px;line-height: 1.4;">
																										<p style="margin: 0; font-size: 16px;">Name : ${name} <br> Phone Number : ${phone_no} <br>Email : ${email} <br> Business Name : ${business_name} <br> PinCode : ${pincode} <br> Address : ${address}</p>
																									</td>
                                                                                                </tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
																									  If any of the above information is incorrect, please reply to this email or contact our support team immediately.
																									</td>
																								</tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																										<strong>🚀 Next Steps</strong>
																									</td>
                                                                                                </tr>
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																									You can log in to your BillerPe account using the following link: <br>
                                                                                                    <a href="https://pos.billerpe.com/#/hotelLogin" target="_blank">pos.billerpe.com</a>
																									</td>
																								</tr>
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
																									Once logged in, you can start using your software right away.
																									</td>
																								</tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																										<strong>Need Help?</strong>
																									</td>
                                                                                                </tr>
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																									If you face any issues, our support team is ready to assist you. <br>
                                                                                                    📞 Call us:<a href="tel:+91 97371 00886" target="_blank">+91 97371 00886</a><br>
                                                                                                    📧 Email us:<a href="mailto:support@billerpe.com" target="_blank">support@billerpe.com</a>
																									</td>
																								</tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
																									If you face any issues, our support team is ready to assist you. <br>
                                                                                                    
																									</td>
                                                                                                </tr>
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 3px;">
																									Best Regards,																									</td>
																								</tr>
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
																									Team BillerPe
																									</td>
																								</tr>
																							</table>
																						</td>
																					</tr>
																				</table>
																				<!-- END Section - Intro -->


																				<!-- END Section - Separator Line -->


																				<!-- END Section - Posts -->
																			</td>
																		</tr>
																	</table>
																	<!-- END Main -->
																</td>
															</tr>
														</table>
													</td>
												</tr>
											</table>
											<!-- END Container -->

											<!-- Footer -->
											<table width="100%" border="0" cellspacing="0" cellpadding="0">
												<tr>
													<td class="p-50 mpx-15" bgcolor="#949196" style="border-radius: 0 0 10px 10px; padding: 50px;">
														<table width="100%" border="0" cellspacing="0" cellpadding="0">
															<tr>
																<td align="center" class="pb-20" style="padding-bottom: 20px;">
																	<!-- Socials -->
																	<table border="0" cellspacing="0" cellpadding="0">
																		<tr>
																			<!-- insta -->
																			<td class="img" width="34" style="font-size:0pt; line-height:0pt; text-align:left;">
																				<a href="https://www.instagram.com/billerpeofficial/?igsh=MTBscmUyMWozdWQ2cw%3D%3D" target="_blank">
                                                                                   <img src="https://uatbackend.billerpe.com/images/instagram.png" width="34" height="34" alt="">
																				</a>
																			</td>
																			<!-- facebook -->
																			<td class="img" width="15" style="font-size:0pt; line-height:0pt; text-align:left;"></td>
																			<td class="img" width="34" style="font-size:0pt; line-height:0pt; text-align:left;">
																				<a href="#" target="_blank">
																				<img src="https://uatbackend.billerpe.com/images/facebook.png" width="34" height="34" alt="">
																			    </a>
																			</td>
																			<!-- x -->
																			<td class="img" width="15" style="font-size:0pt; line-height:0pt; text-align:left;"></td>
																			<td class="img" width="34" style="font-size:0pt; line-height:0pt; text-align:left;">
																				<a href="#" target="_blank">
																				<img src="https://uatbackend.billerpe.com/images/x.png" width="34" height="34" alt="">
																			    </a>
																			</td>
																			
																			<td class="img" width="15" style="font-size:0pt; line-height:0pt; text-align:left;"></td>
																			<td class="img" width="34" style="font-size:0pt; line-height:0pt; text-align:left;">
																				<a href="#" target="_blank">
																				<img src="https://uatbackend.billerpe.com/images/linkd-in.png" width="34" height="34" alt="">
																			    </a>
																			</td>
																		</tr>
																	</table>
																	<!-- END Socials -->
																</td>
															</tr>
															<tr>
																<td class="text-14 lh-24 a-center c-white l-white pb-20" style="font-size:14px; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 24px; text-align:center; color:#ffffff; padding-bottom: 20px;">
																1210, Zion Z1, Near Avalon Hotel, Sindhu Bhavan Marg, Bodakdev, Ahmedabad, Gujarat. 380054
																	<br />
																	<a href="tel:+91 97371 00886" target="_blank" class="link c-white" style="text-decoration:none; color:#ffffff;"><span class="link c-white" style="text-decoration:none; color:#ffffff;">+91 97371 00886</span></a> 
																	<br />
																	<a href="mailto:support@billerpe.com" target="_blank" class="link c-white" style="text-decoration:none; color:#ffffff;"><span class="link c-white" style="text-decoration:none; color:#ffffff;">support@billerpe.com</span></a> - <a href="https://www.billerpe.com" target="_blank" class="link c-white" style="text-decoration:none; color:#ffffff;"><span class="link c-white" style="text-decoration:none; color:#ffffff;">www.website.com</span></a>
																</td>
															</tr>
															<tr>
																<td align="center">
																
																	<table border="0" cellspacing="0" cellpadding="0">
																		<tr>
																			
																			<td class="img" width="15" style="font-size:0pt; line-height:0pt; text-align:left;"></td>
																			<td class="img" width="117" style="font-size:0pt; line-height:0pt; text-align:left;">
																				<a href="https://www.billerpe.com" target="_blank"><img src="https://uatbackend.billerpe.com/images/billerpewhite.png" width="117" border="0" style="height:auto" alt="" /></a>
																			</td>
																		</tr>
																	</table>
																	
																</td>
															</tr>
														</table>
													</td>
												</tr>
											</table> 

											
										</td>
									</tr>
								</table>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</center>
</body>

</html>
    `
}
const getMailContentForOrderPlaced = (data) => {
	const { name, mobile, address1, city, state, pincode, email, grandAmount, subtotal, gst } = data.dataValues;
	const { orderId, date } = data
	const items = data.dataValues.items

	console.log(items, "Data:::here:::")
	return `
 <!DOCTYPE>
<html>

<head>

    <meta http-equiv="Content-type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <!-- <meta name="format-detection" content="date=no" />
	<meta name="format-detection" content="address=no" />
	<meta name="format-detection" content="telephone=no" />
	<meta name="x-apple-disable-message-reformatting" /> -->
    <!--[if !mso]><!-->
    <link href="https://fonts.googleapis.com/css?family=PT+Sans:400,400i,700,700i&display=swap" rel="stylesheet" />
    <!--<![endif]-->
    <title>Email Template</title>



    <style type="text/css" media="screen">
        body {
            padding: 0 !important;
            margin: 0 auto !important;
            display: block !important;
            min-width: 100% !important;
            width: 100% !important;
            background: #fff;
            -webkit-text-size-adjust: none
        }

        a {
            color: #c5202b;
            text-decoration: none
        }

        p {
            padding: 0 !important;
            margin: 0 !important
        }

        img {
            margin: 0 !important;
            -ms-interpolation-mode: bicubic;
        }

        a[x-apple-data-detectors] {
            color: inherit !important;
            text-decoration: inherit !important;
            font-size: inherit !important;
            font-family: inherit !important;
            font-weight: inherit !important;
            line-height: inherit !important;
        }

        .btn-16 a {
            display: block;
            padding: 15px 35px;
            text-decoration: none;
        }

        .btn-20 a {
            display: block;
            padding: 15px 35px;
            text-decoration: none;
        }

        .l-white a {
            color: #ffffff;
        }

        .l-black a {
            color: #282828;
        }

        .l-pink a {
            color: #c5202b;
        }

        .l-grey a {
            color: #6e6e6e;
        }

        .l-purple a {
            color: #9128df;
        }

        .gradient {
            background: linear-gradient(to right, #f0c7ca 0%, #c5202b 100%);
        }

        .btn-secondary {
            border-radius: 10px;
            background: linear-gradient(to right, #9028df 0%, #f3189e 100%);
        }


        /* Mobile styles */
        @media only screen and (max-device-width: 480px),
        only screen and (max-width: 480px) {
            .mpx-10 {
                padding-left: 10px !important;
                padding-right: 10px !important;
            }

            .mpx-15 {
                padding-left: 15px !important;
                padding-right: 15px !important;
            }

            u+.body .gwfw {
                width: 100% !important;
                width: 100vw !important;
            }

            .td,
            .m-shell {
                width: 100% !important;
                min-width: 100% !important;
            }

            .mt-left {
                text-align: left !important;
            }

            .mt-center {
                text-align: center !important;
            }

            .mt-right {
                text-align: right !important;
            }

            .me-left {
                margin-right: auto !important;
            }

            .me-center {
                margin: 0 auto !important;
            }

            .me-right {
                margin-left: auto !important;
            }

            .mh-auto {
                height: auto !important;
            }

            .mw-auto {
                width: auto !important;
            }

            .fluid-img img {
                width: 100% !important;
                max-width: 100% !important;
                height: auto !important;
            }

            .column,
            .column-top,
            .column-dir-top {
                float: left !important;
                width: 100% !important;
                display: block !important;
            }

            .m-hide {
                display: none !important;
                width: 0 !important;
                height: 0 !important;
                font-size: 0 !important;
                line-height: 0 !important;
                min-height: 0 !important;
            }

            .m-block {
                display: block !important;
            }

            .mw-15 {
                width: 15px !important;
            }

            .mw-2p {
                width: 2% !important;
            }

            .mw-32p {
                width: 32% !important;
            }

            .mw-49p {
                width: 49% !important;
            }

            .mw-50p {
                width: 50% !important;
            }

            .mw-100p {
                width: 100% !important;
            }

            .mmt-0 {
                margin-top: 0 !important;
            }
        }

        .shipping-row td {
            padding: 10px 0;
            border-bottom: 2px solid #e0e0e0;
        }

        .payment-row td {
            padding-top: 25px;
            font-size: 18px;
            border-bottom: none;
        }
    </style>
</head>

<body class="body"
    style="padding:0 !important; margin:0 auto !important; display:block !important; min-width:100% !important; width:100% !important; background:#fff; -webkit-text-size-adjust:none;">
    <center>
        <table width="100%" border="0" cellspacing="0" cellpadding="0"
            style="margin: 0; padding: 0; width: 100%; height: 100%;" bgcolor="#f8f8f8" class="gwfw">
            <tr>
                <td style="margin: 0; padding: 0; width: 100%; height: 100%;" align="center" valign="top">
                    <table width="600" border="0" cellspacing="0" cellpadding="0" class="m-shell">
                        <tr>
                            <td class="td"
                                style="width:600px; min-width:600px; font-size:0pt; line-height:0pt; padding:0; margin:0; font-weight:normal;">
                                <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                    <tr>
                                        <td class="mpx-10">
                                
                                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                                <tr>
                                                    <td class="text-12 c-grey l-grey a-right py-20"
                                                        style="font-size:12px; line-height:16px; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; color:#6e6e6e; text-align:right; padding-top: 20px; padding-bottom: 20px;">

                                                    </td>
                                                </tr>
                                            </table>


                                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                                <tr>
                                                    <td class="gradient pt-10"
                                                        style="border-radius: 10px 10px 0 0; padding-top: 10px;"
                                                        bgcolor="#f3189e">
                                                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                                            <tr>
                                                                <td style="border-radius: 10px 10px 0 0;"
                                                                    bgcolor="#ffffff">
                                                                    <!-- Logo -->
                                                                    <table width="100%" border="0" cellspacing="0"
                                                                        cellpadding="0">
                                                                        <tr>
                                                                            <td class="img-center p-30 px-15"
                                                                                style="font-size:0pt; line-height:0pt; text-align:center; padding: 30px; padding-left: 15px; padding-right: 15px;">
                                                                                <a href="https://www.billerpe.com/"
                                                                                    target="_blank">
                                                                                    <img src="https://uatbackend.billerpe.com/images/logo-png.png"
                                                                                        width="160" border="0"
                                                                                        style="height:auto" alt="" />
                                                                                    
                                                                                </a>
                                                                            </td>
                                                                        </tr>
                                                                    </table>
                                                                  
                                                                    <table width="100%" border="0" cellspacing="0"
                                                                        cellpadding="0">
                                                                        <tr>
                                                                            <td class="px-50 mpx-15"
                                                                                style="padding-left: 50px; padding-right: 50px;">
                                                                                <!-- Section - Intro -->
                                                                                <table width="100%" border="0"
                                                                                    cellspacing="0" cellpadding="0">
                                                                                    <tr>
                                                                                        <td class="pb-50"
                                                                                            style="padding-bottom: 30px;">
                                                                                            <table width="100%"
                                                                                                border="0"
                                                                                                cellspacing="0"
                                                                                                cellpadding="0">

                                                                                                <tr>
                                                                                                    <td class="title-36 a-center pb-15"
                                                                                                        style="font-size:28px; line-height:30px; color:#282828; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; text-align:center; padding-bottom: 20px;">
                                                                                                        <!-- <strong>Hey, welcome!</strong> -->
                                                                                                        <strong>Order
                                                                                                            Confirmation
                                                                                                            – Thank You
                                                                                                            for Your
                                                                                                            Purchase,
                                                                                                            ${name}!</strong>
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
                                                                                                        Dear
                                                                                                        ${name},
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
                                                                                                        <strong>Thank
                                                                                                            you for
                                                                                                            shopping
                                                                                                            with
                                                                                                            BillerPe
                                                                                                            🎉</strong>
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
                                                                                                        We’re pleased to
                                                                                                        inform you that
                                                                                                        we’ve
                                                                                                        successfully
                                                                                                        received your
                                                                                                        order. Please
                                                                                                        find the details
                                                                                                        below:
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
                                                                                                        <strong>📝 Order
                                                                                                            Summary</strong>
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; padding-bottom: 10px;line-height: 1.4;">
                                                                                                        <p
                                                                                                            style="margin: 0; font-size: 16px;">
                                                                                                            Order ID :
                                                                                                            ${orderId}
                                                                                                            <br> Order
                                                                                                            Date & Time
                                                                                                            :
                                                                                                            ${date}

                                                                                                        </p>
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
                                                                                                        <strong>📦 Item
                                                                                                            Details</strong>
                                                                                                    </td>
                                                                                                </tr>
                                                                                               

                                                                                                <tr>
                                                                                                    <table
                                                                                                        style="width: 100%; border-collapse: collapse;">
                                                                                                        <thead
                                                                                                            style=" border-bottom: 2px solid #e0e0e0;">
                                                                                                            <tr>

                                                                                                                <th
                                                                                                                    style="color: #999;font-size: 13px;font-weight: 600;text-transform: uppercase;padding: 12px 8px;text-align: left;">
                                                                                                                    ITEM
                                                                                                                </th>
                                                                                                              
                                                                                                                <th
                                                                                                                    style="color: #999;font-size: 13px;font-weight: 600;text-transform: uppercase;padding: 12px 8px;text-align: left;">
                                                                                                                    Qty.
                                                                                                                </th>
                                                                                                                <th
                                                                                                                    style="color: #999;font-size: 13px;font-weight: 600;text-transform: uppercase;padding: 12px 8px;text-align: right;">
                                                                                                                    PRICE
                                                                                                                </th>
                                                                                                                <th
                                                                                                                    style="color: #999;font-size: 13px;font-weight: 600;text-transform: uppercase;padding: 12px 8px;text-align: right;">
                                                                                                                    AMOUNT
                                                                                                                </th>
                                                                                                            </tr>
                                                                                                        </thead>
                                                                                                        <tbody>
                                                                                                            ${items.map(el => {
		return `<tr>
                                                                                                                <td
                                                                                                                style="  color: #999;font-size: 16px;padding: 20px 8px;border-bottom: 1px solid #f0f0f0;display: -webkit-box;line-clamp:2 ; -webkit-line-clamp: 2;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;line-height: 1.4;max-height: 2.8em;">
                                                                                                               ${el?.title || ""}
                                                                                                            </td>
                                                                                                            <td
                                                                                                            style="color: #999; font-size: 16px;  padding: 20px 8px; border-bottom: 1px solid #f0f0f0;">
                                                                                                                   ${el?.quantity || ""}
                                                                                                                </td>
                                                                                                               
                                                                                                                <td
                                                                                                                style="color: #999; font-size: 16px;  padding: 20px 8px; border-bottom: 1px solid #f0f0f0; text-align: right;">
                                                                                                                ${el?.price || 0}
                                                                                                            </td>
                                                                                                                <td
                                                                                                                style="color: #999; font-size: 16px;  padding: 20px 8px; border-bottom: 1px solid #f0f0f0; text-align: right;">
                                                                                                                ${el?.price * el.quantity || 0}
                                                                                                            </td>
                                                                                                        </tr>`
	})}

                                                                                                            <tr
                                                                                                                class="total-row">
                                                                                                                <td
                                                                                                                    colspan="3" style="padding-bottom: 40px">
                                                                                                                </td>
                                                                                                                <td
                                                                                                                    style="color: #000; font-size: 14px; text-align: right; padding-bottom: 0px; min-width: 160px;">
                                                                                                                    Sub
                                                                                                                    Total:
                                                                                                                    ₹ ${subtotal}
                                                                                                                </td>
                                                                                                            </tr>
                                                                                                            <tr
                                                                                                                class="total-row">
                                                                                                                <td
                                                                                                                    colspan="3" >
                                                                                                                </td>
                                                                                                                <td
                                                                                                                    style="color: #000; font-size: 14px; text-align: right; padding-bottom: 20px; min-width: 160px;">
                                                                                                                    CGST@9%:
                                                                                                                    ₹ ${(gst / 2).toFixed(2)}
                                                                                                                </td>
                                                                                                            </tr>
                                                                                                            <tr
                                                                                                                class="total-row">
                                                                                                                <td
                                                                                                                    colspan="3">
                                                                                                                </td>
                                                                                                                <td
                                                                                                                    style="color: #000; font-size: 14px; text-align: right; padding-bottom: 20px; min-width: 160px;">
                                                                                                                    SGST@9%:
                                                                                                                    ₹ ${(gst / 2).toFixed(2)}
                                                                                                                </td>
                                                                                                            </tr>
                                                                                                            <tr
                                                                                                                class="total-row">
                                                                                                                <td
                                                                                                                    colspan="3">
                                                                                                                </td>
                                                                                                                <td
                                                                                                                    style="color: #000; font-size: 14px; text-align: right; padding-bottom: 20px; min-width: 170px;">
                                                                                                                    Grand Amount:
                                                                                                                    ₹ ${grandAmount}
                                                                                                                </td>
                                                                                                            </tr>
                                                                                                        </tbody>
                                                                                                    </table>

                                                                                                </tr>



                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
                                                                                                        <strong>👤
                                                                                                            Customer
                                                                                                            Information</strong>
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <!--  data -->
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; padding-bottom: 10px;line-height: 1.4;">
                                                                                                        <p
                                                                                                            style="margin: 0; font-size: 16px;">
                                                                                                            Name :
                                                                                                            ${name}
                                                                                                            <br> Phone :
                                                                                                            ${mobile}
                                                                                                            <br>Total
                                                                                                            Amount :
                                                                                                            ${data.grandAmount}
                                                                                                            <br> Email:
                                                                                                            ${email}
                                                                                                            <br>Address:
                                                                                                            ${address1},
                                                                                                            ${city} 
                                                                                                            ,${state}–
                                                                                                            ${pincode},
                                                                                                        </p>
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
                                                                                                        If any of the
                                                                                                        above
                                                                                                        information is
                                                                                                        incorrect,
                                                                                                        please
                                                                                                        contact <a
                                                                                                            href="mailto:support@billerpe.com"
                                                                                                            target="_blank">support@billerpe.com</a>
                                                                                                        immediately.
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
                                                                                                        <strong>🚚 Next
                                                                                                            Steps</strong>
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
                                                                                                        Your order is
                                                                                                        now being
                                                                                                        processed. <br>
                                                                                                        Once it has been
                                                                                                        shipped, we’ll
                                                                                                        send you another
                                                                                                        email with the
                                                                                                        tracking
                                                                                                        details.
                                                                                                    </td>
                                                                                                </tr>

                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
                                                                                                        <strong>Need
                                                                                                            Help?</strong>
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
                                                                                                        If you have any
                                                                                                        questions, our
                                                                                                        support team is
                                                                                                        ready to assist
                                                                                                        you. <br>
                                                                                                        📞 Call us:<a
                                                                                                            href="tel:+91 97371 00886"
                                                                                                            target="_blank">+91
                                                                                                            97371
                                                                                                            00886</a><br>
                                                                                                        📧 Email us:<a
                                                                                                            href="mailto:support@billerpe.com"
                                                                                                            target="_blank">support@billerpe.com</a>
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
                                                                                                        If you face any
                                                                                                        issues, our
                                                                                                        support team is
                                                                                                        ready to assist
                                                                                                        you. <br>

                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
                                                                                                        <strong>Thank
                                                                                                            you again
                                                                                                            for choosing
                                                                                                            BillerPe.</strong><br>
                                                                                                        We truly
                                                                                                        appreciate your
                                                                                                        trust and look
                                                                                                        forward to
                                                                                                        serving you
                                                                                                        again soon!

                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 3px;">
                                                                                                        Best Regards,
                                                                                                    </td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25"
                                                                                                        style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
                                                                                                        Team BillerPe
                                                                                                    </td>
                                                                                                </tr>
                                                                                            </table>
                                                                                        </td>
                                                                                    </tr>
                                                                                </table>

                                                                            </td>
                                                                        </tr>
                                                                    </table>

                                                                </td>
                                                            </tr>
                                                        </table>
                                                    </td>
                                                </tr>
                                            </table>



                                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                                <tr>
                                                    <td class="p-50 mpx-15" bgcolor="#949196"
                                                        style="border-radius: 0 0 10px 10px; padding: 50px;">
                                                        <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                                            <tr>
                                                                <td align="center" class="pb-20"
                                                                    style="padding-bottom: 20px;">

                                                                    <table border="0" cellspacing="0" cellpadding="0">
                                                                        <tr>

                                                                            <td class="img" width="34"
                                                                                style="font-size:0pt; line-height:0pt; text-align:left;">
                                                                                <a href="https://www.instagram.com/billerpeofficial/?igsh=MTBscmUyMWozdWQ2cw%3D%3D"
                                                                                    target="_blank">
                                                                                    <img src="https://uatbackend.billerpe.com/images/instagram.png"
                                                                                        width="34" height="34" alt="">
                                                                                </a>
                                                                            </td>

                                                                            <td class="img" width="15"
                                                                                style="font-size:0pt; line-height:0pt; text-align:left;">
                                                                            </td>
                                                                            <td class="img" width="34"
                                                                                style="font-size:0pt; line-height:0pt; text-align:left;">
                                                                                <a href="#" target="_blank">
                                                                                    <img src="https://uatbackend.billerpe.com/images/facebook.png"
                                                                                        width="34" height="34" alt="">
                                                                                </a>
                                                                            </td>
                                                                            <!-- x -->
                                                                            <td class="img" width="15"
                                                                                style="font-size:0pt; line-height:0pt; text-align:left;">
                                                                            </td>
                                                                            <td class="img" width="34"
                                                                                style="font-size:0pt; line-height:0pt; text-align:left;">
                                                                                <a href="#" target="_blank">
                                                                                    <img src="https://uatbackend.billerpe.com/images/x.png"
                                                                                        width="34" height="34" alt="">
                                                                                </a>
                                                                            </td>

                                                                            <td class="img" width="15"
                                                                                style="font-size:0pt; line-height:0pt; text-align:left;">
                                                                            </td>
                                                                            <td class="img" width="34"
                                                                                style="font-size:0pt; line-height:0pt; text-align:left;">
                                                                                <a href="#" target="_blank">
                                                                                    <img src="https://uatbackend.billerpe.com/images/linkd-in.png"
                                                                                        width="34" height="34" alt="">
                                                                                </a>
                                                                            </td>
                                                                        </tr>
                                                                    </table>

                                                                </td>
                                                            </tr>
                                                            <tr>
                                                                <td class="text-14 lh-24 a-center c-white l-white pb-20"
                                                                    style="font-size:14px; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 24px; text-align:center; color:#ffffff; padding-bottom: 20px;">
                                                                    1210, Zion Z1, Near Avalon Hotel, Sindhu Bhavan
                                                                    Marg, Bodakdev, Ahmedabad, Gujarat. 380054
                                                                    <br />
                                                                    <a href="tel:+91 97371 00886" target="_blank"
                                                                        class="link c-white"
                                                                        style="text-decoration:none; color:#ffffff;"><span
                                                                            class="link c-white"
                                                                            style="text-decoration:none; color:#ffffff;">+91
                                                                            97371 00886</span></a>
                                                                    <!-- <a href="tel:+13697181973" target="_blank" class="link c-white" style="text-decoration:none; color:#ffffff;"><span class="link c-white" style="text-decoration:none; color:#ffffff;">+91 97371 00886</span></a> -->
                                                                    <br />
                                                                    <a href="mailto:support@billerpe.com"
                                                                        target="_blank" class="link c-white"
                                                                        style="text-decoration:none; color:#ffffff;"><span
                                                                            class="link c-white"
                                                                            style="text-decoration:none; color:#ffffff;">support@billerpe.com</span></a>
                                                                    - <a href="https://www.billerpe.com" target="_blank"
                                                                        class="link c-white"
                                                                        style="text-decoration:none; color:#ffffff;"><span
                                                                            class="link c-white"
                                                                            style="text-decoration:none; color:#ffffff;">www.website.com</span></a>
                                                                </td>
                                                            </tr>
                                                            <tr>
                                                                <td align="center">

                                                                    <table border="0" cellspacing="0" cellpadding="0">
                                                                        <tr>

                                                                            <td class="img" width="15"
                                                                                style="font-size:0pt; line-height:0pt; text-align:left;">
                                                                            </td>
                                                                            <td class="img" width="117"
                                                                                style="font-size:0pt; line-height:0pt; text-align:left;">
                                                                                <a href="https://www.billerpe.com"
                                                                                    target="_blank"><img
                                                                                        src="https://uatbackend.billerpe.com/images/billerpewhite.png"
                                                                                        width="117" border="0"
                                                                                        style="height:auto"
                                                                                        alt="" /></a>
                                                                            </td>
                                                                        </tr>
                                                                    </table>

                                                                </td>
                                                            </tr>
                                                        </table>
                                                    </td>
                                                </tr>
                                            </table>


                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </center>
</body>

</html>
   `
}
const getMailContentForShippedOrder = (data) => {
	const { name, grandAmount, subtotal, gst } = data.dataValues;
	const { order_tracking_id } = data
	const { orderId } = data
	const items = data.dataValues.items
	console.log(data, "All::::Data")
	console.log(items, "Data:::here:::")
	return `<!DOCTYPE>
<html>

<head>

	<meta http-equiv="Content-type" content="text/html; charset=utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
	<meta http-equiv="X-UA-Compatible" content="IE=edge" />
	<!-- <meta name="format-detection" content="date=no" />
	<meta name="format-detection" content="address=no" />
	<meta name="format-detection" content="telephone=no" />
	<meta name="x-apple-disable-message-reformatting" /> -->
	<!--[if !mso]><!-->
	<link href="https://fonts.googleapis.com/css?family=PT+Sans:400,400i,700,700i&display=swap" rel="stylesheet" />
	<!--<![endif]-->
	<title>Email Template</title>



	<style type="text/css" media="screen">
		body {
			padding: 0 !important;
			margin: 0 auto !important;
			display: block !important;
			min-width: 100% !important;
			width: 100% !important;
			background: #fff;
			-webkit-text-size-adjust: none
		}

		a {
			color: #c5202b;
			text-decoration: none
		}

		p {
			padding: 0 !important;
			margin: 0 !important
		}

		img {
			margin: 0 !important;
			-ms-interpolation-mode: bicubic;
		}

		a[x-apple-data-detectors] {
			color: inherit !important;
			text-decoration: inherit !important;
			font-size: inherit !important;
			font-family: inherit !important;
			font-weight: inherit !important;
			line-height: inherit !important;
		}

		.btn-16 a {
			display: block;
			padding: 15px 35px;
			text-decoration: none;
		}

		.btn-20 a {
			display: block;
			padding: 15px 35px;
			text-decoration: none;
		}

		.l-white a {
			color: #ffffff;
		}

		.l-black a {
			color: #282828;
		}

		.l-pink a {
			color: #c5202b;
		}

		.l-grey a {
			color: #6e6e6e;
		}

		.l-purple a {
			color: #9128df;
		}

		.gradient {
			background: linear-gradient(to right, #f0c7ca 0%, #c5202b 100%);
		}

		.btn-secondary {
			border-radius: 10px;
			background: linear-gradient(to right, #9028df 0%, #f3189e 100%);
		}


		/* Mobile styles */
		@media only screen and (max-device-width: 480px),
		only screen and (max-width: 480px) {
			.mpx-10 {
				padding-left: 10px !important;
				padding-right: 10px !important;
			}

			.mpx-15 {
				padding-left: 15px !important;
				padding-right: 15px !important;
			}

			u+.body .gwfw {
				width: 100% !important;
				width: 100vw !important;
			}

			.td,
			.m-shell {
				width: 100% !important;
				min-width: 100% !important;
			}

			.mt-left {
				text-align: left !important;
			}

			.mt-center {
				text-align: center !important;
			}

			.mt-right {
				text-align: right !important;
			}

			.me-left {
				margin-right: auto !important;
			}

			.me-center {
				margin: 0 auto !important;
			}

			.me-right {
				margin-left: auto !important;
			}

			.mh-auto {
				height: auto !important;
			}

			.mw-auto {
				width: auto !important;
			}

			.fluid-img img {
				width: 100% !important;
				max-width: 100% !important;
				height: auto !important;
			}

			.column,
			.column-top,
			.column-dir-top {
				float: left !important;
				width: 100% !important;
				display: block !important;
			}

			.m-hide {
				display: none !important;
				width: 0 !important;
				height: 0 !important;
				font-size: 0 !important;
				line-height: 0 !important;
				min-height: 0 !important;
			}

			.m-block {
				display: block !important;
			}

			.mw-15 {
				width: 15px !important;
			}

			.mw-2p {
				width: 2% !important;
			}

			.mw-32p {
				width: 32% !important;
			}

			.mw-49p {
				width: 49% !important;
			}

			.mw-50p {
				width: 50% !important;
			}

			.mw-100p {
				width: 100% !important;
			}

			.mmt-0 {
				margin-top: 0 !important;
			}
		}
	</style>
</head>

<body class="body" style="padding:0 !important; margin:0 auto !important; display:block !important; min-width:100% !important; width:100% !important; background:#fff; -webkit-text-size-adjust:none;">
	<center>
		<table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 0; padding: 0; width: 100%; height: 100%;" bgcolor="#f8f8f8" class="gwfw">
			<tr>
				<td style="margin: 0; padding: 0; width: 100%; height: 100%;" align="center" valign="top">
					<table width="600" border="0" cellspacing="0" cellpadding="0" class="m-shell">
						<tr>
							<td class="td" style="width:600px; min-width:600px; font-size:0pt; line-height:0pt; padding:0; margin:0; font-weight:normal;">
								<table width="100%" border="0" cellspacing="0" cellpadding="0">
									<tr>
										<td class="mpx-10">
											<!-- Top -->
											<table width="100%" border="0" cellspacing="0" cellpadding="0">
												<tr>
													<td class="text-12 c-grey l-grey a-right py-20" style="font-size:12px; line-height:16px; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; color:#6e6e6e; text-align:right; padding-top: 20px; padding-bottom: 20px;">
														<!-- <a href="#" target="_blank" class="link c-grey" style="text-decoration:none; color:#6e6e6e;"><span class="link c-grey" style="text-decoration:none; color:#6e6e6e;">View this email in your browser</span></a> -->
													</td>
												</tr>
											</table>
											<!-- END Top -->

											<!-- Container -->
											<table width="100%" border="0" cellspacing="0" cellpadding="0">
												<tr>
													<td class="gradient pt-10" style="border-radius: 10px 10px 0 0; padding-top: 10px;" bgcolor="#f3189e">
														<table width="100%" border="0" cellspacing="0" cellpadding="0">
															<tr>
																<td style="border-radius: 10px 10px 0 0;" bgcolor="#ffffff">
																	<!-- Logo -->
																	<table width="100%" border="0" cellspacing="0" cellpadding="0">
																		<tr>
																			<td class="img-center p-30 px-15" style="font-size:0pt; line-height:0pt; text-align:center; padding: 30px; padding-left: 15px; padding-right: 15px;">
																				<a href="https://www.billerpe.com/" target="_blank">
																				<img src="https://uatbackend.billerpe.com/images/logo-png.png" width="160" border="0" style="height:auto" alt="" />
																				</a>
																			</td>
																		</tr>
																	</table>
																	<!-- Logo -->

																	<!-- Main -->
																	<table width="100%" border="0" cellspacing="0" cellpadding="0">
																		<tr>
																			<td class="px-50 mpx-15" style="padding-left: 50px; padding-right: 50px;">
																				<!-- Section - Intro -->
																				<table width="100%" border="0" cellspacing="0" cellpadding="0">
																					<tr>
																						<td class="pb-50" style="padding-bottom: 30px;">
																							<table width="100%" border="0" cellspacing="0" cellpadding="0">

																								<tr>
																									<td class="title-36 a-center pb-15" style="font-size:28px; line-height:40px; color:#282828; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; text-align:center; padding-bottom: 15px;">
																										<!-- <strong>Hey, welcome!</strong> -->
																										<strong>Subject: Your Order #${orderId} Has Been Shipped 🚚</strong>
																									</td>
																								</tr>
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
																										Dear ${name},
																									</td>
																								</tr>
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																										<strong>Good news — your order #${orderId} has been shipped! 🎉</strong>
																									</td>
                                                                                                </tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
																										We’re preparing everything to ensure it reaches you as quickly and safely as possible.
																									</td>
                                                                                                </tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																										<strong>📦Here are your shipping details </strong>
																									</td>
                                                                                                </tr>
                                                                                                <tr>
                                                                                                    <td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; padding-bottom: 10px;line-height: 1.4;">
																										<p style="margin: 0; font-size: 16px;"> <br> Traking Id/AWB Number : ${order_tracking_id} <br> Track Your Order : <a href="https://www.delhivery.com/" target="_blank">delhivery.com</a> </p>
																								    </td>
                                                                                                </tr>
                                                                                                <tr>
																								    <table
                                                                                                        style="width: 100%; border-collapse: collapse;">
                                                                                                        <thead
                                                                                                            style=" border-bottom: 2px solid #e0e0e0;">
                                                                                                            <tr>

                                                                                                                <th
                                                                                                                    style="color: #999;font-size: 13px;font-weight: 600;text-transform: uppercase;padding: 12px 8px;text-align: left;">
                                                                                                                    ITEM
                                                                                                                </th>
                                                                                                              
                                                                                                                <th
                                                                                                                    style="color: #999;font-size: 13px;font-weight: 600;text-transform: uppercase;padding: 12px 8px;text-align: left;">
                                                                                                                    Qty.
                                                                                                                </th>
                                                                                                                <th
                                                                                                                    style="color: #999;font-size: 13px;font-weight: 600;text-transform: uppercase;padding: 12px 8px;text-align: right;">
                                                                                                                    PRICE
                                                                                                                </th>
                                                                                                                <th
                                                                                                                    style="color: #999;font-size: 13px;font-weight: 600;text-transform: uppercase;padding: 12px 8px;text-align: right;">
                                                                                                                    AMOUNT
                                                                                                                </th>
                                                                                                            </tr>
                                                                                                        </thead>
                                                                                                        <tbody>
                                                                                                            ${items.map(el => {
		return `<tr>
                                                                                                                <td
                                                                                                                style="  color: #999;font-size: 16px;padding: 20px 8px;border-bottom: 1px solid #f0f0f0;display: -webkit-box;line-clamp:2 ; -webkit-line-clamp: 2;-webkit-box-orient: vertical;overflow: hidden;text-overflow: ellipsis;line-height: 1.4;max-height: 2.8em;">
                                                                                                               ${el?.title || ""}
                                                                                                            </td>
                                                                                                            <td
                                                                                                            style="color: #999; font-size: 16px;  padding: 20px 8px; border-bottom: 1px solid #f0f0f0;">
                                                                                                                   ${el?.quantity || ""}
                                                                                                                </td>
                                                                                                               
                                                                                                                <td
                                                                                                                style="color: #999; font-size: 16px;  padding: 20px 8px; border-bottom: 1px solid #f0f0f0; text-align: right;">
                                                                                                                ${el?.price || 0}
                                                                                                            </td>
                                                                                                                <td
                                                                                                                style="color: #999; font-size: 16px;  padding: 20px 8px; border-bottom: 1px solid #f0f0f0; text-align: right;">
                                                                                                                ${el?.price * el.quantity || 0}
                                                                                                            </td>
                                                                                                        </tr>`
	})}

                                                                                                            <tr
                                                                                                                class="total-row">
                                                                                                                <td
                                                                                                                    colspan="3" style="padding-bottom: 40px">
                                                                                                                </td>
                                                                                                                <td
                                                                                                                    style="color: #000; font-size: 14px; text-align: right; padding-bottom: 0px; min-width: 160px;">
                                                                                                                    Sub
                                                                                                                    Total:
                                                                                                                    ₹ ${subtotal}
                                                                                                                </td>
                                                                                                            </tr>
                                                                                                            <tr
                                                                                                                class="total-row">
                                                                                                                <td
                                                                                                                    colspan="3" >
                                                                                                                </td>
                                                                                                                <td
                                                                                                                    style="color: #000; font-size: 14px; text-align: right; padding-bottom: 20px; min-width: 160px;">
                                                                                                                    CGST@9%:
                                                                                                                    ₹ ${(gst / 2).toFixed(2)}
                                                                                                                </td>
                                                                                                            </tr>
                                                                                                            <tr
                                                                                                                class="total-row">
                                                                                                                <td
                                                                                                                    colspan="3">
                                                                                                                </td>
                                                                                                                <td
                                                                                                                    style="color: #000; font-size: 14px; text-align: right; padding-bottom: 20px; min-width: 160px;">
                                                                                                                    SGST@9%:
                                                                                                                    ₹ ${(gst / 2).toFixed(2)}
                                                                                                                </td>
                                                                                                            </tr>
                                                                                                            <tr
                                                                                                                class="total-row">
                                                                                                                <td
                                                                                                                    colspan="3">
                                                                                                                </td>
                                                                                                                <td
                                                                                                                    style="color: #000; font-size: 14px; text-align: right; padding-bottom: 20px; min-width: 170px;">
                                                                                                                    Grand Amount:
                                                                                                                    ₹ ${grandAmount}
                                                                                                                </td>
                                                                                                            </tr>
                                                                                                        </tbody>
                                                                                                    </table>
																								</tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 5px;">
																										If you have any questions or need assistance, feel free contact our support team at <a href="mailto:support@billerpe.com" target="_blank">support@billerpe.com</a>.
																									</td>
                                                                                                </tr>
                                                                                                <tr>
																									<!--  data -->
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; padding-bottom: 10px;line-height: 1.4;">
																										<p style="margin: 0; font-size: 16px;">Thank you for shopping with BillerPe!</p>
																									</td>
                                                                                                </tr>
                                                                                                <tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
																									 We truly appreciate your business.
																									</td>
																								</tr>																								 
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 3px;">
																									Best Regards,																									</td>
																								</tr>
																								<tr>
																									<td class="text-16 lh-26 a-center pb-25" style="font-size:16px; color:#333333; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 26px; padding-bottom: 25px;">
																									Team BillerPe
																									</td>
																								</tr>
																							</table>
																						</td>
																					</tr>
																				</table>
																				
																			</td>
																		</tr>
																	</table>
																	
																</td>
															</tr>
														</table>
													</td>
												</tr>
											</table>
											<!-- END Container -->

											<!-- Footer -->
											<table width="100%" border="0" cellspacing="0" cellpadding="0">
												<tr>
													<td class="p-50 mpx-15" bgcolor="#949196" style="border-radius: 0 0 10px 10px; padding: 50px;">
														<table width="100%" border="0" cellspacing="0" cellpadding="0">
															<tr>
																<td align="center" class="pb-20" style="padding-bottom: 20px;">
																	<!-- Socials -->
																	<table border="0" cellspacing="0" cellpadding="0">
																		<tr>
																			<!-- insta -->
																			<td class="img" width="34" style="font-size:0pt; line-height:0pt; text-align:left;">
																				<a href="https://www.instagram.com/billerpeofficial/?igsh=MTBscmUyMWozdWQ2cw%3D%3D" target="_blank">
                                                                                   <img src="https://uatbackend.billerpe.com/images/instagram.png" width="34" height="34" alt="">
																				</a>
																			</td>
																			<!-- facebook -->
																			<td class="img" width="15" style="font-size:0pt; line-height:0pt; text-align:left;"></td>
																			<td class="img" width="34" style="font-size:0pt; line-height:0pt; text-align:left;">
																				<a href="#" target="_blank">
																				<img src="https://uatbackend.billerpe.com/images/facebook.png" width="34" height="34" alt="">
																			    </a>
																			</td>
																			<!-- x -->
																			<td class="img" width="15" style="font-size:0pt; line-height:0pt; text-align:left;"></td>
																			<td class="img" width="34" style="font-size:0pt; line-height:0pt; text-align:left;">
																				<a href="#" target="_blank">
																				<img src="https://uatbackend.billerpe.com/images/x.png" width="34" height="34" alt="">
																			    </a>
																			</td>
																			<!-- linkdin -->
																			<td class="img" width="15" style="font-size:0pt; line-height:0pt; text-align:left;"></td>
																			<td class="img" width="34" style="font-size:0pt; line-height:0pt; text-align:left;">
																				<a href="#" target="_blank">
																				<img src="https://uatbackend.billerpe.com/images/linkd-in.png" width="34" height="34" alt="">
																			    </a>
																			</td>
																		</tr>
																	</table>
																	<!-- END Socials -->
																</td>
															</tr>
															<tr>
																<td class="text-14 lh-24 a-center c-white l-white pb-20" style="font-size:14px; font-family:'PT Sans', Arial, sans-serif; min-width:auto !important; line-height: 24px; text-align:center; color:#ffffff; padding-bottom: 20px;">
																1210, Zion Z1, Near Avalon Hotel, Sindhu Bhavan Marg, Bodakdev, Ahmedabad, Gujarat. 380054
																	<br />
																	<a href="tel:+91 97371 00886" target="_blank" class="link c-white" style="text-decoration:none; color:#ffffff;"><span class="link c-white" style="text-decoration:none; color:#ffffff;">+91 97371 00886</span></a> 
																	<!-- <a href="tel:+13697181973" target="_blank" class="link c-white" style="text-decoration:none; color:#ffffff;"><span class="link c-white" style="text-decoration:none; color:#ffffff;">+91 97371 00886</span></a> -->
																	<br />
																	<a href="mailto:support@billerpe.com" target="_blank" class="link c-white" style="text-decoration:none; color:#ffffff;"><span class="link c-white" style="text-decoration:none; color:#ffffff;">support@billerpe.com</span></a> - <a href="https://www.billerpe.com" target="_blank" class="link c-white" style="text-decoration:none; color:#ffffff;"><span class="link c-white" style="text-decoration:none; color:#ffffff;">www.website.com</span></a>
																</td>
															</tr>
															<tr>
																<td align="center">
																	
																	<table border="0" cellspacing="0" cellpadding="0">
																		<tr>
																			<!-- <td class="img" width="117" style="font-size:0pt; line-height:0pt; text-align:left;">
																					<a href="#" target="_blank"><img src="http://3.110.40.193:4000/email-images/btn_appstore.png" width="117" height="40" border="0" alt="" /></a>
																				</td> -->
																			<td class="img" width="15" style="font-size:0pt; line-height:0pt; text-align:left;"></td>
																			<td class="img" width="117" style="font-size:0pt; line-height:0pt; text-align:left;">
																				<a href="https://www.billerpe.com" target="_blank"><img src="https://uatbackend.billerpe.com/images/billerpewhite.png" width="117" border="0" style="height:auto" alt="" /></a>
																			</td>
																		</tr>
																	</table>
																
																</td>
															</tr>
														</table>
													</td>
												</tr>
											</table>
										
										</td>
									</tr>
								</table>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</center>
</body>

</html>`
}
async function sendWelcomeEmail(userEmail, data) {
	try {
		const transporter = createMailTransporter();

		const mailOptions = {
			from: {
				name: 'BillerPe Sales',
				address: "no-reply@billerpe.com"
			},
			to: userEmail,
			subject: 'Welcome to Our Platform! 🎉',
			html: getMailContent(data)
		};

		const info = await transporter.sendMail(mailOptions);
		console.log('Email sent successfully:', info.messageId);
		return { success: true, messageId: info.messageId };
	} catch (error) {
		console.error('Error sending email:', error);
		return { success: false, error: error.message };
	}
}
async function sendPurchaseOrderEmail(userEmail, data) {
	try {
		const transporter = createMailTransporter();

		const mailOptions = {
			from: {
				name: 'BillerPe Sales',
				address: "no-reply@billerpe.com"
			},
			to: userEmail,
			subject: 'Thank you For Purchase! 🎉',
			html: getMailContentForOrderPlaced(data)
		};

		const info = await transporter.sendMail(mailOptions);
		console.log('Email sent successfully:', info.messageId);
		return { success: true, messageId: info.messageId };
	} catch (error) {
		console.error('Error sending email:', error);
		return { success: false, error: error.message };
	}
}
async function sendShippedMail(userEmail, data) {
	try {
		const transporter = createMailTransporter();

		const mailOptions = {
			from: {
				name: 'BillerPe Sales',
				address: "no-reply@billerpe.com"
			},
			to: userEmail,
			subject: 'Your Order Shipped! 🎉',
			html: getMailContentForShippedOrder(data)
		};

		const info = await transporter.sendMail(mailOptions);
		console.log('Email sent successfully:', info.messageId);
		return { success: true, messageId: info.messageId };
	} catch (error) {
		console.error('Error sending email:', error);
		return { success: false, error: error.message };
	}
}
module.exports = { sendShippedMail, sendWelcomeEmail, sendPurchaseOrderEmail };

// sendWelcomeEmail("makwanahardik2040@gmail.com", { name: "Hardik Makwana", UserID: "hardik2040", password: "Hardik@9898", phone_no: "9737100886", email: "makwanahardik2040@gmail.com", business_name: "Your Business Name", pincode: "380054", address: "Your Address" })
